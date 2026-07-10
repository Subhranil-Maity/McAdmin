mod api;
mod auth;
mod config;
mod minecraft_files;

use api::{
    ban_player, deop_player, dewhitelist_player, get_all_players, get_config, get_file_content,
    get_online_players, get_server_properties, health, list_config, list_directory, op_player,
    send_server_command, server_status, start_server, stop_server, unban_player,
    update_server_properties, upload_file, whitelist_player, write_file,
};
use auth::ClerkAuthLayer;
use axum::{
    Router,
    http::{HeaderName, HeaderValue, Method, request::Parts},
    routing::{get, post},
};
use circular_queue::CircularQueue;
use config::ConfigManager;
use rcon_tokio::{RconClient, RconClientConfig};
use std::env;
use std::io;
use std::path::{Path as FsPath, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use sysinfo::System;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{Duration, sleep};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::{Level, error, info};

const LOG_BUFFER_CAPACITY: usize = 15_000;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) system: Arc<TokioMutex<System>>,
    pub(crate) config: Arc<ConfigManager>,
    pub(crate) minecraft: Arc<TokioMutex<MinecraftServerRuntime>>,
    pub(crate) logs: LogBuffer,
    pub(crate) rcon: Arc<RconManager>,
    pub(crate) server_dir: Arc<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct LogBuffer {
    lines: Arc<StdMutex<CircularQueue<String>>>,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            lines: Arc::new(StdMutex::new(CircularQueue::with_capacity(capacity))),
        }
    }

    pub(crate) fn get_last_n(&self, n: usize) -> Vec<String> {
        let lock = self.lines.lock().unwrap();
        let mut result = lock.iter().take(n).cloned().collect::<Vec<_>>();
        result.reverse();
        result
    }

    pub(crate) fn push(&self, line: String) {
        self.lines.lock().unwrap().push(line);
    }
}

struct RconManager {
    config: RconClientConfig,
    client: TokioMutex<Option<RconClient<TcpStream>>>,
}

impl RconManager {
    fn new(config: RconClientConfig) -> Self {
        Self {
            config,
            client: TokioMutex::new(None),
        }
    }

    pub(crate) async fn execute(&self, command: &str) -> Result<String, String> {
        let mut client = self.client.lock().await;

        if client.is_none() {
            *client = Some(
                RconClient::connect(self.config.clone())
                    .await
                    .map_err(|error| error.to_string())?,
            );
        }

        let result = client
            .as_mut()
            .expect("RCON client must be initialized")
            .execute(command)
            .await;

        match result {
            Ok(response) => Ok(response),
            Err(error) => {
                *client = None;
                Err(error.to_string())
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MinecraftServerState {
    Offline,
    Starting,
    Online,
}

impl MinecraftServerState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Offline => "OFFLINE",
            Self::Starting => "STARTING",
            Self::Online => "ONLINE",
        }
    }
}

#[derive(Debug)]
pub(crate) struct MinecraftServerRuntime {
    pub(crate) state: MinecraftServerState,
    pub(crate) process_id: Option<u32>,
    pub(crate) child: Option<Child>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).init();
    dotenvy::dotenv().expect(".env file is required at runtime");

    let host = env::var("ADMIN_WORKER_HOST").expect("ADMIN_WORKER_HOST must be set");
    let port = env::var("ADMIN_WORKER_PORT")
        .expect("ADMIN_WORKER_PORT must be set")
        .parse::<u16>()
        .expect("ADMIN_WORKER_PORT must be a valid u16 port");
    let bind_addr = format!("{host}:{port}");
    let home_dir = env::var("HOME_DIR").expect("HOME_DIR must be set");
    let server_dir = Arc::new(PathBuf::from(home_dir));
    let config_path = server_dir.join("admin_worker_config.json");
    let rcon_config = RconClientConfig::new(
        env::var("RCON_HOST").expect("RCON_HOST must be set"),
        env::var("RCON_PORT")
            .expect("RCON_PORT must be set")
            .parse::<u16>()
            .expect("RCON_PORT must be a valid u16 port"),
        env::var("RCON_PASSWORD").expect("RCON_PASSWORD must be set"),
    )
    .auto_reconnect(true)
    .max_reconnect_attempts(3);

    let clerk_secret_key = env::var("CLERK_SECRET_KEY").expect("CLERK_SECRET_KEY must be set");

    let state = AppState {
        system: Arc::new(TokioMutex::new(System::new_all())),
        config: Arc::new(
            ConfigManager::load(config_path)
                .await
                .expect("failed to load config manager"),
        ),
        minecraft: Arc::new(TokioMutex::new(MinecraftServerRuntime {
            state: MinecraftServerState::Offline,
            process_id: None,
            child: None,
        })),
        logs: LogBuffer::new(LOG_BUFFER_CAPACITY),
        rcon: Arc::new(RconManager::new(rcon_config)),
        server_dir,
    };

    info!("loaded runtime configuration");

    let app = Router::new()
        .route("/", get(health))
        .route("/api/status", get(server_status))
        .route("/api/server/start", post(start_server))
        .route("/api/server/stop", post(stop_server))
        .route("/api/server/command", post(send_server_command))
        .route(
            "/api/server/properties",
            get(get_server_properties).post(update_server_properties),
        )
        .route("/api/server/players", get(get_all_players))
        .route("/api/server/players/online", get(get_online_players))
        .route("/api/server/players/ban", post(ban_player))
        .route("/api/server/players/unban", post(unban_player))
        .route("/api/server/players/whitelist", post(whitelist_player))
        .route("/api/server/players/dewhitelist", post(dewhitelist_player))
        .route("/api/server/players/op", post(op_player))
        .route("/api/server/players/deop", post(deop_player))
        .route("/api/files", get(list_directory))
        .route("/api/files/content", get(get_file_content))
        .route("/api/files/write", post(write_file))
        .route(
            "/api/files/upload",
            post(upload_file).layer(axum::extract::DefaultBodyLimit::max(1024 * 1024 * 1024)),
        )
        .route("/api/config", get(list_config))
        .route("/api/config/{key}", get(get_config))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(ClerkAuthLayer::new(clerk_secret_key))
        .layer(cors_layer())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind TCP listener");

    info!("listening on {}", bind_addr);

    axum::serve(listener, app)
        .await
        .expect("failed to start Axum server");
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _request_parts: &Parts| is_local_origin(origin),
        ))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            HeaderName::from_static("authorization"),
            HeaderName::from_static("content-type"),
        ])
        .allow_credentials(true)
}

fn is_local_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    [
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
        "https://127.0.0.1",
    ]
    .iter()
    .any(|allowed_origin| {
        origin == *allowed_origin || origin.starts_with(&format!("{allowed_origin}:"))
    })
}

pub(crate) async fn monitor_minecraft_server(minecraft: Arc<TokioMutex<MinecraftServerRuntime>>) {
    loop {
        sleep(Duration::from_secs(1)).await;

        let exit_status = {
            let mut runtime = minecraft.lock().await;
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
                info!(
                    "Minecraft server stopped with exit code: {:?}",
                    status.code()
                );
                reset_minecraft_runtime(&minecraft).await;
                return;
            }
            Some(Err(error)) => {
                error!("Minecraft server status check failed: {error}");
                reset_minecraft_runtime(&minecraft).await;
                return;
            }
            None => {}
        }
    }
}

pub(crate) fn resolve_jar_path(jar_path: PathBuf) -> PathBuf {
    if jar_path.is_absolute() {
        jar_path
    } else {
        env::current_dir()
            .expect("failed to read current working directory")
            .join(jar_path)
    }
}

pub(crate) async fn start_minecraft_server(
    jar_path: &FsPath,
    server_dir: &FsPath,
    ram_gb: u32,
    log_buffer: LogBuffer,
    minecraft: &mut MinecraftServerRuntime,
) -> io::Result<()> {
    if !jar_path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Jar file not found",
        ));
    }
    if !server_dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Server directory not found",
        ));
    }

    let xms = format!("-Xms{}G", ram_gb);
    let xmx = format!("-Xmx{}G", ram_gb);

    info!("Starting Minecraft server inside: {}", server_dir.display());

    let mut child = Command::new("java")
        .current_dir(server_dir)
        .arg(&xms)
        .arg(&xmx)
        .arg("-jar")
        .arg(jar_path)
        .arg("--nogui")
        .arg("--noconsole")
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let process_id = child.id();

    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, log_buffer.clone(), None);
    }

    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, log_buffer.clone(), Some("[ERROR] "));
    }

    minecraft.state = MinecraftServerState::Online;
    minecraft.process_id = process_id;
    minecraft.child = Some(child);

    Ok(())
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

async fn reset_minecraft_runtime(minecraft: &Arc<TokioMutex<MinecraftServerRuntime>>) {
    let mut runtime = minecraft.lock().await;
    runtime.state = MinecraftServerState::Offline;
    runtime.process_id = None;
    runtime.child = None;
}
