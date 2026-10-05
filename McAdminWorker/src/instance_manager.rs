use chrono::Utc;
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex as TokioMutex, RwLock as TokioRwLock};
use tracing::{error, info};
use uuid::Uuid;

use crate::instance_config::{InstanceConfig, McConfigManager};
use crate::instance_runtime::{InstanceRuntime, MinecraftServerState, monitor_instance};
use crate::java_download;
use crate::java_manager::{JavaManager, ResolvedJava};

/// How a start request was handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    /// The server process was launched.
    Started,
    /// A managed Java runtime is being downloaded; the server launches afterwards.
    PreparingJava,
}

pub struct InstanceManager {
    home_dir: PathBuf,
    rcon_host: String,
    instances: TokioRwLock<HashMap<String, Arc<TokioMutex<InstanceRuntime>>>>,
    config_manager: Arc<McConfigManager>,
    java_manager: Arc<JavaManager>,
}

impl InstanceManager {
    pub async fn new(
        home_dir: PathBuf,
        rcon_host: String,
        config_manager: Arc<McConfigManager>,
        java_manager: Arc<JavaManager>,
    ) -> Self {
        let manager = Self {
            home_dir,
            rcon_host,
            instances: TokioRwLock::new(HashMap::new()),
            config_manager,
            java_manager,
        };

        manager.load_instances().await;
        manager
    }

    async fn load_instances(&self) {
        let configs = self.config_manager.list_instances().await;
        let mut map = self.instances.write().await;

        for config in configs {
            let instance_dir = self.home_dir.join(&config.folder);
            let runtime = InstanceRuntime::new(config.clone(), instance_dir, &self.rcon_host);
            map.insert(config.id.clone(), Arc::new(TokioMutex::new(runtime)));
        }

        info!("Loaded {} Minecraft instances from config", map.len());
    }

    pub async fn get(&self, id: &str) -> Option<Arc<TokioMutex<InstanceRuntime>>> {
        let map = self.instances.read().await;
        map.get(id).cloned()
    }

    pub async fn list(&self) -> Vec<Arc<TokioMutex<InstanceRuntime>>> {
        let map = self.instances.read().await;
        map.values().cloned().collect()
    }

    pub async fn create_instance(
        &self,
        name: String,
        ram_gb: u32,
        minecraft_version: Option<String>,
        java_runtime: Option<String>,
        preferred_server_port: Option<u16>,
        preferred_rcon_port: Option<u16>,
        jar_data: &[u8],
        jar_filename: Option<String>,
        owner_id: Option<String>,
    ) -> io::Result<InstanceConfig> {
        let id = Uuid::new_v4().to_string();
        let folder_name = format!("instances/{id}");
        let instance_dir = self.home_dir.join(&folder_name);

        tokio::fs::create_dir_all(&instance_dir).await.map_err(|e| {
            io::Error::new(
                io::ErrorKind::Other,
                format!("Failed to create instance directory: {e}"),
            )
        })?;

        let jar_name = jar_filename.unwrap_or_else(|| "server.jar".to_string());
        let jar_path = instance_dir.join(&jar_name);
        tokio::fs::write(&jar_path, jar_data).await.map_err(|e| {
            io::Error::new(
                io::ErrorKind::Other,
                format!("Failed to write server jar: {e}"),
            )
        })?;

        let (server_port, rcon_port) = self
            .config_manager
            .allocate_ports(preferred_server_port, preferred_rcon_port)
            .await;
        let rcon_password = format!("rcon_{}", Uuid::new_v4().simple());

        // Write eula.txt
        let eula_path = instance_dir.join("eula.txt");
        tokio::fs::write(
            &eula_path,
            "# By changing the setting below to TRUE you are indicating your agreement to our EULA\neula=true\n",
        )
        .await?;

        // Write initial server.properties
        let properties_path = instance_dir.join("server.properties");
        let initial_properties = format!(
            "server-port={server_port}\n\
             enable-rcon=true\n\
             rcon.port={rcon_port}\n\
             rcon.password={rcon_password}\n\
             motd={name}\n\
             difficulty=easy\n\
             gamemode=survival\n\
             max-players=20\n\
             online-mode=true\n\
             pvp=true\n"
        );
        tokio::fs::write(&properties_path, initial_properties).await?;

        let config = InstanceConfig {
            id: id.clone(),
            name,
            folder: folder_name,
            jar_name,
            server_port,
            rcon_port,
            rcon_password,
            ram_gb,
            minecraft_version,
            java_runtime,
            created_at: Utc::now().to_rfc3339(),
            owner_id,
            admins: Vec::new(),
        };

        self.config_manager.add_instance(config.clone()).await?;

        let runtime = InstanceRuntime::new(config.clone(), instance_dir, &self.rcon_host);
        let runtime_arc = Arc::new(TokioMutex::new(runtime));

        let mut map = self.instances.write().await;
        map.insert(id, runtime_arc);

        info!("Created new instance '{}' (ID: {})", config.name, config.id);

        Ok(config)
    }

    pub async fn delete_instance(&self, id: &str) -> io::Result<()> {
        let runtime_opt = {
            let mut map = self.instances.write().await;
            map.remove(id)
        };

        if let Some(runtime_arc) = runtime_opt {
            let mut runtime = runtime_arc.lock().await;
            runtime.deallocate_all().await;

            let dir = runtime.instance_dir.clone();
            drop(runtime);

            if dir.exists() {
                if let Err(e) = tokio::fs::remove_dir_all(&dir).await {
                    error!("Failed to remove directory {}: {e}", dir.display());
                }
            }
        }

        self.config_manager.remove_instance(id).await?;
        info!("Deleted instance '{id}'");
        Ok(())
    }

    pub async fn start_instance(&self, id: &str) -> io::Result<StartOutcome> {
        let runtime_arc = self.get(id).await.ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "Instance not found")
        })?;

        let resolved = {
            let runtime = runtime_arc.lock().await;
            self.java_manager
                .resolve(
                    runtime.config.java_runtime.as_deref(),
                    runtime.config.minecraft_version.as_deref(),
                )
                .await
        };

        let java_bin = match resolved {
            ResolvedJava::Path(path) => path,
            ResolvedJava::Managed(major) if java_download::is_installed(&self.home_dir, major).await => {
                java_download::managed_java_bin(&self.home_dir, major)
                    .to_string_lossy()
                    .to_string()
            }
            ResolvedJava::Managed(major) => {
                self.start_with_java_download(runtime_arc, major).await?;
                return Ok(StartOutcome::PreparingJava);
            }
        };

        {
            let mut runtime = runtime_arc.lock().await;
            runtime.start(&java_bin).await?;
        }

        tokio::spawn(monitor_instance(runtime_arc));
        Ok(StartOutcome::Started)
    }

    /// Puts the instance in `Starting`, downloads the managed JRE in the background
    /// (progress goes to the instance console), then launches the server.
    async fn start_with_java_download(
        &self,
        runtime_arc: Arc<TokioMutex<InstanceRuntime>>,
        major: u32,
    ) -> io::Result<()> {
        let logs = {
            let mut runtime = runtime_arc.lock().await;
            if runtime.state != MinecraftServerState::Offline {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "Server is already running or starting",
                ));
            }
            runtime.logs.clear();
            runtime.state = MinecraftServerState::Starting;
            runtime.logs.clone()
        };

        let home_dir = self.home_dir.clone();
        tokio::spawn(async move {
            let result = java_download::ensure_installed(&home_dir, major, |line| {
                logs.push(line);
            })
            .await;

            let mut runtime = runtime_arc.lock().await;
            if runtime.state != MinecraftServerState::Starting {
                // Stopped while downloading.
                return;
            }

            match result {
                Ok(bin) => {
                    if let Err(e) = runtime.launch(&bin.to_string_lossy()).await {
                        error!("Failed to launch instance '{}': {e}", runtime.config.name);
                        runtime.state = MinecraftServerState::Offline;
                        return;
                    }
                    drop(runtime);
                    monitor_instance(runtime_arc).await;
                }
                Err(e) => {
                    error!("Java {major} install failed for '{}': {e}", runtime.config.name);
                    runtime.logs.push(format!("[ERROR] [Java] {e}"));
                    runtime.state = MinecraftServerState::Offline;
                }
            }
        });

        Ok(())
    }

    pub async fn stop_instance(&self, id: &str) -> io::Result<()> {
        let runtime_arc = self.get(id).await.ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "Instance not found")
        })?;

        let mut runtime = runtime_arc.lock().await;
        runtime.stop().await?;
        Ok(())
    }
}
