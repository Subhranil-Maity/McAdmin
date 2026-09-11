use circular_queue::CircularQueue;
use rcon_tokio::{RconClient, RconClientConfig};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::broadcast;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{Duration, sleep, timeout};
use tracing::{error, info};

use crate::instance_config::InstanceConfig;

const RCON_TIMEOUT: Duration = Duration::from_secs(5);
pub const LOG_BUFFER_CAPACITY: usize = 15_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexedLog {
    pub index: u64,
    pub line: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum InstanceLogEvent {
    #[serde(rename = "log")]
    Log(IndexedLog),
    #[serde(rename = "log_clear")]
    LogClear,
}

#[derive(Clone, Debug)]
pub struct LogBuffer {
    capacity: usize,
    lines: Arc<StdMutex<CircularQueue<IndexedLog>>>,
    next_index: Arc<AtomicU64>,
    tx: broadcast::Sender<InstanceLogEvent>,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self {
            capacity,
            lines: Arc::new(StdMutex::new(CircularQueue::with_capacity(capacity))),
            next_index: Arc::new(AtomicU64::new(0)),
            tx,
        }
    }

    pub fn get_all(&self) -> Vec<IndexedLog> {
        let lock = self.lines.lock().unwrap();
        let mut result = lock.iter().cloned().collect::<Vec<_>>();
        result.reverse();
        result
    }

    pub fn get_last_n(&self, n: usize) -> Vec<IndexedLog> {
        let lock = self.lines.lock().unwrap();
        let mut result = lock.iter().take(n).cloned().collect::<Vec<_>>();
        result.reverse();
        result
    }

    pub fn get_last_n_strings(&self, n: usize) -> Vec<String> {
        self.get_last_n(n).into_iter().map(|l| l.line).collect()
    }

    pub fn push(&self, line: String) -> IndexedLog {
        let index = self.next_index.fetch_add(1, Ordering::SeqCst);
        let entry = IndexedLog { index, line };
        self.lines.lock().unwrap().push(entry.clone());
        let _ = self.tx.send(InstanceLogEvent::Log(entry.clone()));
        entry
    }

    pub fn clear(&self) {
        let mut lock = self.lines.lock().unwrap();
        *lock = CircularQueue::with_capacity(self.capacity);
        self.next_index.store(0, Ordering::SeqCst);
        let _ = self.tx.send(InstanceLogEvent::LogClear);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<InstanceLogEvent> {
        self.tx.subscribe()
    }
}

#[derive(Debug)]
pub struct RconManager {
    config: RconClientConfig,
    client: TokioMutex<Option<RconClient<TcpStream>>>,
}

impl RconManager {
    pub fn new(config: RconClientConfig) -> Self {
        Self {
            config,
            client: TokioMutex::new(None),
        }
    }

    pub async fn execute(&self, command: &str) -> Result<String, String> {
        let mut client = self.client.lock().await;

        if client.is_none() {
            let connected = timeout(RCON_TIMEOUT, RconClient::connect(self.config.clone()))
                .await
                .map_err(|_| "RCON connection timed out".to_string())?
                .map_err(|error| error.to_string())?;
            *client = Some(connected);
        }

        let result = timeout(
            RCON_TIMEOUT,
            client
                .as_mut()
                .expect("RCON client must be initialized")
                .execute(command),
        )
        .await
        .map_err(|_| "RCON command timed out".to_string())?;

        match result {
            Ok(response) => Ok(response),
            Err(error) => {
                *client = None;
                Err(error.to_string())
            }
        }
    }

    /// Explicitly disconnect and drop the RCON TCP stream, freeing socket resources.
    pub async fn disconnect(&self) {
        let mut client = self.client.lock().await;
        *client = None;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MinecraftServerState {
    Offline,
    Starting,
    Online,
}

impl MinecraftServerState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Offline => "OFFLINE",
            Self::Starting => "STARTING",
            Self::Online => "ONLINE",
        }
    }
}

pub struct InstanceRuntime {
    pub config: InstanceConfig,
    pub state: MinecraftServerState,
    pub process_id: Option<u32>,
    pub child: Option<Child>,
    pub logs: LogBuffer,
    pub rcon: Arc<RconManager>,
    pub instance_dir: PathBuf,
}

impl InstanceRuntime {
    pub fn new(config: InstanceConfig, instance_dir: PathBuf, rcon_host: &str) -> Self {
        let rcon_config = RconClientConfig::new(
            rcon_host.to_string(),
            config.rcon_port,
            config.rcon_password.clone(),
        )
        .auto_reconnect(false)
        .max_reconnect_attempts(1);

        Self {
            config,
            state: MinecraftServerState::Offline,
            process_id: None,
            child: None,
            logs: LogBuffer::new(LOG_BUFFER_CAPACITY),
            rcon: Arc::new(RconManager::new(rcon_config)),
            instance_dir,
        }
    }

    pub async fn start(&mut self, java_bin: &str) -> io::Result<()> {
        if self.state != MinecraftServerState::Offline {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Server is already running or starting",
            ));
        }

        // Clear previous logs on server start so each start only shows its own logs
        self.logs.clear();

        let jar_path = self.instance_dir.join(&self.config.jar_name);
        if !jar_path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Jar file not found at {}", jar_path.display()),
            ));
        }
        if !self.instance_dir.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Instance directory not found at {}", self.instance_dir.display()),
            ));
        }

        let ram_gb = self.config.ram_gb;
        let xms = format!("-Xms{}G", ram_gb);
        let xmx = format!("-Xmx{}G", ram_gb);

        info!(
            "Starting Minecraft instance '{}' with Java binary '{}' in {}",
            self.config.name,
            java_bin,
            self.instance_dir.display()
        );

        let child_res = Command::new(java_bin)
            .current_dir(&self.instance_dir)
            .arg(&xms)
            .arg(&xmx)
            .arg("-jar")
            .arg(&jar_path)
            .arg("--nogui")
            .stdin(Stdio::inherit())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match child_res {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("Failed to launch Minecraft server with Java binary '{java_bin}': {e}");
                self.logs.push(format!("[ERROR] {err_msg}"));
                return Err(io::Error::new(e.kind(), err_msg));
            }
        };

        let process_id = child.id();

        if let Some(stdout) = child.stdout.take() {
            spawn_log_reader(stdout, self.logs.clone(), None);
        }

        if let Some(stderr) = child.stderr.take() {
            spawn_log_reader(stderr, self.logs.clone(), Some("[ERROR] "));
        }

        self.state = MinecraftServerState::Online;
        self.process_id = process_id;
        self.child = Some(child);

        Ok(())
    }

    /// Stops the server and deallocates process and RCON socket resources.
    pub async fn stop(&mut self) -> io::Result<()> {
        info!("Stopping Minecraft instance '{}'", self.config.name);

        self.state = MinecraftServerState::Offline;
        self.process_id = None;

        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }

        // Deallocate RCON connection and close socket
        self.rcon.disconnect().await;

        Ok(())
    }

    /// Complete cleanup when instance is deleted
    pub async fn deallocate_all(&mut self) {
        let _ = self.stop().await;
    }
}

fn spawn_log_reader<R>(stream: R, log_buffer: LogBuffer, prefix: Option<&'static str>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            let line = match prefix {
                Some(prefix) => format!("{prefix}{line}"),
                None => line,
            };
            log_buffer.push(line);
        }
    });
}

pub async fn monitor_instance(instance: Arc<TokioMutex<InstanceRuntime>>) {
    loop {
        sleep(Duration::from_secs(1)).await;

        let exit_status = {
            let mut runtime = instance.lock().await;
            let Some(child) = runtime.child.as_mut() else {
                return;
            };

            match child.try_wait() {
                Ok(Some(status)) => Some(Ok(status)),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            }
        };

        match exit_status {
            Some(Ok(status)) => {
                let mut runtime = instance.lock().await;
                info!(
                    "Instance '{}' stopped with exit code: {:?}",
                    runtime.config.name,
                    status.code()
                );
                runtime.state = MinecraftServerState::Offline;
                runtime.process_id = None;
                runtime.child = None;
                runtime.rcon.disconnect().await;
                return;
            }
            Some(Err(error)) => {
                let mut runtime = instance.lock().await;
                error!(
                    "Instance '{}' status check failed: {error}",
                    runtime.config.name
                );
                runtime.state = MinecraftServerState::Offline;
                runtime.process_id = None;
                runtime.child = None;
                runtime.rcon.disconnect().await;
                return;
            }
            None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_log_buffer_atomic_indexing_and_ordering() {
        let buffer = LogBuffer::new(10);
        let mut rx = buffer.subscribe();

        for i in 0..5 {
            let entry = buffer.push(format!("log message {i}"));
            assert_eq!(entry.index, i);
        }

        let all = buffer.get_all();
        assert_eq!(all.len(), 5);
        for (i, entry) in all.iter().enumerate() {
            assert_eq!(entry.index as usize, i);
            assert_eq!(entry.line, format!("log message {i}"));
        }

        // Test broadcast events
        for i in 0..5 {
            let event = rx.recv().await.unwrap();
            match event {
                InstanceLogEvent::Log(entry) => {
                    assert_eq!(entry.index, i);
                    assert_eq!(entry.line, format!("log message {i}"));
                }
                _ => panic!("Expected Log event"),
            }
        }
    }

    #[tokio::test]
    async fn test_log_buffer_clear_resets_index() {
        let buffer = LogBuffer::new(10);
        let mut rx = buffer.subscribe();

        buffer.push("first line".to_string());
        buffer.push("second line".to_string());
        assert_eq!(buffer.get_all().len(), 2);

        buffer.clear();
        assert_eq!(buffer.get_all().len(), 0);

        // Next push should start from index 0
        let fresh_entry = buffer.push("fresh line".to_string());
        assert_eq!(fresh_entry.index, 0);
        assert_eq!(fresh_entry.line, "fresh line");

        // Verify broadcast events including clear
        let _ = rx.recv().await.unwrap(); // first
        let _ = rx.recv().await.unwrap(); // second
        let clear_ev = rx.recv().await.unwrap(); // clear
        match clear_ev {
            InstanceLogEvent::LogClear => {}
            _ => panic!("Expected LogClear event"),
        }
        let fresh_ev = rx.recv().await.unwrap(); // fresh
        match fresh_ev {
            InstanceLogEvent::Log(e) => assert_eq!(e.index, 0),
            _ => panic!("Expected Log event"),
        }
    }
}

