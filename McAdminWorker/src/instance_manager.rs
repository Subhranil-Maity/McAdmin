use chrono::Utc;
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex as TokioMutex, RwLock as TokioRwLock};
use tokio::time::{Instant, sleep};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::http_download::{self, Hash};
use crate::instance_config::{InstanceConfig, McConfigManager, ServerType};
use crate::instance_runtime::{InstanceRuntime, MinecraftServerState, monitor_instance};
use crate::java_download;
use crate::java_manager::{JavaManager, ResolvedJava};
use crate::mc_versions::{self, VersionCatalog};

pub const VANILLA_JAR_NAME: &str = "server.jar";
/// Fabric's launcher downloads the vanilla jar as `server.jar`, so it needs another name.
pub const FABRIC_JAR_NAME: &str = "fabric-server-launch.jar";

pub fn managed_jar_name(server_type: ServerType) -> &'static str {
    match server_type {
        ServerType::Fabric => FABRIC_JAR_NAME,
        _ => VANILLA_JAR_NAME,
    }
}

/// Server type and jar source for a new instance.
pub enum JarSource {
    Uploaded { data: Vec<u8>, filename: Option<String> },
    Managed(ServerType),
}

/// How long a server gets to save and exit after `stop` before it is killed.
pub const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(60);
/// Shorter timeout when the instance is being deleted anyway.
const DELETE_STOP_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// How a start request was handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    /// The server process was launched.
    Started,
    /// A server jar and/or managed Java runtime is being downloaded; the server
    /// launches afterwards (progress goes to the console).
    Preparing,
}

pub struct InstanceManager {
    home_dir: PathBuf,
    rcon_host: String,
    instances: TokioRwLock<HashMap<String, Arc<TokioMutex<InstanceRuntime>>>>,
    config_manager: Arc<McConfigManager>,
    java_manager: Arc<JavaManager>,
    catalog: Arc<VersionCatalog>,
}

impl InstanceManager {
    pub async fn new(
        home_dir: PathBuf,
        rcon_host: String,
        config_manager: Arc<McConfigManager>,
        java_manager: Arc<JavaManager>,
        catalog: Arc<VersionCatalog>,
    ) -> Self {
        let manager = Self {
            home_dir,
            rcon_host,
            instances: TokioRwLock::new(HashMap::new()),
            config_manager,
            java_manager,
            catalog,
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
        jar: JarSource,
        loader_version: Option<String>,
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

        let (server_type, jar_name) = match jar {
            JarSource::Uploaded { data, filename } => {
                let jar_name = filename
                    .filter(|n| crate::content::is_safe_file_name(n))
                    .unwrap_or_else(|| "server.jar".to_string());
                let jar_path = instance_dir.join(&jar_name);
                tokio::fs::write(&jar_path, data).await.map_err(|e| {
                    io::Error::new(
                        io::ErrorKind::Other,
                        format!("Failed to write server jar: {e}"),
                    )
                })?;
                (ServerType::Custom, jar_name)
            }
            // Managed jars are downloaded on first start.
            JarSource::Managed(t) => (t, managed_jar_name(t).to_string()),
        };

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
            server_type,
            loader_version: if server_type == ServerType::Fabric { loader_version } else { None },
            installed_jar_version: None,
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
            graceful_stop(&runtime_arc, DELETE_STOP_TIMEOUT).await;
            let mut runtime = runtime_arc.lock().await;
            runtime.force_kill().await;

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

        let (config, jar_exists) = {
            let runtime = runtime_arc.lock().await;
            if runtime.state != MinecraftServerState::Offline {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    match runtime.state {
                        MinecraftServerState::Installing => "A modpack is being installed",
                        _ => "Server is already running or starting",
                    },
                ));
            }
            let jar = runtime.instance_dir.join(&runtime.config.jar_name);
            (runtime.config.clone(), jar.exists())
        };

        let needs_jar = config.server_type.is_managed()
            && (!jar_exists || config.installed_jar_version != config.wanted_jar_version());

        let resolved = self
            .java_manager
            .resolve(config.java_runtime.as_deref(), config.minecraft_version.as_deref())
            .await;

        let java_bin = match &resolved {
            ResolvedJava::Path(path) => Some(path.clone()),
            ResolvedJava::Managed(major) if java_download::is_installed(&self.home_dir, *major).await => Some(
                java_download::managed_java_bin(&self.home_dir, *major)
                    .to_string_lossy()
                    .to_string(),
            ),
            ResolvedJava::Managed(_) => None,
        };

        if let (false, Some(java_bin)) = (needs_jar, java_bin) {
            {
                let mut runtime = runtime_arc.lock().await;
                runtime.start(&java_bin).await?;
            }
            tokio::spawn(monitor_instance(runtime_arc));
            return Ok(StartOutcome::Started);
        }

        let java_major = match resolved {
            ResolvedJava::Managed(major) => Some(major),
            ResolvedJava::Path(_) => None,
        };
        self.start_with_preparation(runtime_arc, needs_jar, java_major).await?;
        Ok(StartOutcome::Preparing)
    }

    /// Puts the instance in `Starting`, downloads the server jar and/or managed JRE
    /// in the background (progress goes to the instance console), then launches.
    async fn start_with_preparation(
        &self,
        runtime_arc: Arc<TokioMutex<InstanceRuntime>>,
        needs_jar: bool,
        java_major: Option<u32>,
    ) -> io::Result<()> {
        let (logs, config, instance_dir) = {
            let mut runtime = runtime_arc.lock().await;
            if runtime.state != MinecraftServerState::Offline {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "Server is already running or starting",
                ));
            }
            runtime.logs.clear();
            runtime.state = MinecraftServerState::Starting;
            (runtime.logs.clone(), runtime.config.clone(), runtime.instance_dir.clone())
        };

        let home_dir = self.home_dir.clone();
        let catalog = self.catalog.clone();
        let config_manager = self.config_manager.clone();
        let java_manager = self.java_manager.clone();
        tokio::spawn(async move {
            let log = |line: String| {
                logs.push(line);
            };
            let fail = |runtime: &mut InstanceRuntime, msg: String| {
                error!("Failed to prepare '{}': {msg}", runtime.config.name);
                runtime.logs.push(format!("[ERROR] {msg}"));
                runtime.state = MinecraftServerState::Offline;
            };

            if needs_jar {
                match prepare_managed_jar(&catalog, &config, &instance_dir, &log).await {
                    Ok(Some(installed)) => {
                        let jar_name = managed_jar_name(config.server_type).to_string();
                        let loader = installed.loader_version.clone();
                        let updated = config_manager
                            .update_with(&config.id, |c| {
                                c.installed_jar_version = Some(installed.jar_version.clone());
                                c.jar_name = jar_name.clone();
                                if loader.is_some() {
                                    c.loader_version = loader.clone();
                                }
                            })
                            .await;
                        if let Ok(Some(updated)) = updated {
                            let mut runtime = runtime_arc.lock().await;
                            runtime.config.installed_jar_version = updated.installed_jar_version;
                            runtime.config.jar_name = updated.jar_name;
                            runtime.config.loader_version = updated.loader_version;
                        }
                    }
                    Ok(None) => {}
                    Err(e) => {
                        let mut runtime = runtime_arc.lock().await;
                        if runtime.state == MinecraftServerState::Starting {
                            fail(&mut runtime, format!("[McAdmin] {e}"));
                        }
                        return;
                    }
                }
            }

            if runtime_arc.lock().await.state != MinecraftServerState::Starting {
                return; // Stopped while preparing.
            }

            let java_bin = match java_major {
                Some(major) => match java_download::ensure_installed(&home_dir, major, &log).await {
                    Ok(bin) => bin.to_string_lossy().to_string(),
                    Err(e) => {
                        let mut runtime = runtime_arc.lock().await;
                        if runtime.state == MinecraftServerState::Starting {
                            fail(&mut runtime, format!("[Java] {e}"));
                        }
                        return;
                    }
                },
                None => {
                    let current = runtime_arc.lock().await.config.clone();
                    match java_manager
                        .resolve(current.java_runtime.as_deref(), current.minecraft_version.as_deref())
                        .await
                    {
                        ResolvedJava::Path(p) => p,
                        ResolvedJava::Managed(major) => {
                            match java_download::ensure_installed(&home_dir, major, &log).await {
                                Ok(bin) => bin.to_string_lossy().to_string(),
                                Err(e) => {
                                    let mut runtime = runtime_arc.lock().await;
                                    if runtime.state == MinecraftServerState::Starting {
                                        fail(&mut runtime, format!("[Java] {e}"));
                                    }
                                    return;
                                }
                            }
                        }
                    }
                }
            };

            let mut runtime = runtime_arc.lock().await;
            if runtime.state != MinecraftServerState::Starting {
                return; // Stopped while downloading.
            }
            if let Err(e) = runtime.launch(&java_bin).await {
                error!("Failed to launch instance '{}': {e}", runtime.config.name);
                runtime.logs.push(format!("[ERROR] {e}"));
                runtime.state = MinecraftServerState::Offline;
                return;
            }
            drop(runtime);
            monitor_instance(runtime_arc).await;
        });

        Ok(())
    }

    /// Marks an offline instance as `Installing` (modpack install). Returns false
    /// if it is not offline.
    pub async fn begin_install(&self, id: &str) -> bool {
        let Some(runtime_arc) = self.get(id).await else { return false };
        let mut runtime = runtime_arc.lock().await;
        if runtime.state != MinecraftServerState::Offline {
            return false;
        }
        runtime.logs.clear();
        runtime.state = MinecraftServerState::Installing;
        true
    }

    /// Ends an install started with `begin_install`, applying config changes.
    pub async fn end_install(&self, id: &str, updated: Option<InstanceConfig>) {
        let Some(runtime_arc) = self.get(id).await else { return };
        let mut runtime = runtime_arc.lock().await;
        if let Some(cfg) = updated {
            runtime.config = cfg;
        }
        if runtime.state == MinecraftServerState::Installing {
            runtime.state = MinecraftServerState::Offline;
        }
    }

    /// Gracefully stops an instance: sends `stop`, waits for the server to save
    /// and exit, and kills it only if it is still running after the timeout.
    pub async fn stop_instance(&self, id: &str) -> io::Result<()> {
        let runtime_arc = self.get(id).await.ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "Instance not found")
        })?;

        graceful_stop(&runtime_arc, GRACEFUL_STOP_TIMEOUT).await;
        Ok(())
    }

    /// Gracefully stops every running instance in parallel (worker shutdown).
    pub async fn stop_all(&self) {
        let runtimes = self.list().await;
        futures_util::future::join_all(
            runtimes
                .iter()
                .map(|runtime| graceful_stop(runtime, GRACEFUL_STOP_TIMEOUT)),
        )
        .await;
    }
}

/// Sends `stop` to the server console and waits up to `timeout` for it to exit,
/// falling back to a kill. The instance lock is only held briefly at each step,
/// so status/WebSocket/metrics keep working while the server shuts down.
async fn graceful_stop(runtime_arc: &Arc<TokioMutex<InstanceRuntime>>, timeout: Duration) {
    let (name, stdin, rcon, logs) = {
        let mut runtime = runtime_arc.lock().await;
        if runtime.state == MinecraftServerState::Installing {
            // Installing a modpack: there is no process; let the install finish.
            return;
        }
        if runtime.child.is_none() {
            // Not running (or still downloading Java): nothing to shut down.
            runtime.mark_exited().await;
            return;
        }
        if runtime.state == MinecraftServerState::Stopping {
            // A stop is already in progress; don't send `stop` twice.
            drop(runtime);
            wait_for_exit(runtime_arc, timeout).await;
            return;
        }
        runtime.state = MinecraftServerState::Stopping;
        (
            runtime.config.name.clone(),
            runtime.stdin.take(),
            runtime.rcon.clone(),
            runtime.logs.clone(),
        )
    };

    info!("Stopping Minecraft instance '{name}' gracefully");
    logs.push("[McAdmin] Sending \"stop\" to server...".to_string());

    let sent_via_stdin = match stdin {
        Some(mut stdin) => stdin.write_all(b"stop\n").await.is_ok() && stdin.flush().await.is_ok(),
        None => false,
    };
    if !sent_via_stdin {
        warn!("Could not write to console of '{name}'; sending stop via RCON");
        if let Err(e) = rcon.execute("stop").await {
            warn!("RCON stop for '{name}' failed: {e}");
            logs.push(format!("[McAdmin] Could not send \"stop\" (console and RCON failed: {e})"));
        }
    }

    if wait_for_exit(runtime_arc, timeout).await {
        logs.push("[McAdmin] Server stopped.".to_string());
        return;
    }

    warn!("Instance '{name}' did not stop within {}s; killing it", timeout.as_secs());
    logs.push(format!(
        "[McAdmin] Server did not stop within {}s; killing process",
        timeout.as_secs()
    ));
    runtime_arc.lock().await.force_kill().await;
}

/// Polls until the server process has exited. Returns false on timeout.
async fn wait_for_exit(runtime_arc: &Arc<TokioMutex<InstanceRuntime>>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        {
            let mut runtime = runtime_arc.lock().await;
            let exited = match runtime.child.as_mut() {
                None => true,
                Some(child) => !matches!(child.try_wait(), Ok(None)),
            };
            if exited {
                runtime.mark_exited().await;
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(STOP_POLL_INTERVAL).await;
    }
}

struct InstalledJar {
    jar_version: String,
    loader_version: Option<String>,
}

/// Downloads the official (and for Fabric, the launcher) jar for `config`.
/// Returns `Ok(None)` when the version is unknown but an existing jar can be used.
async fn prepare_managed_jar(
    catalog: &VersionCatalog,
    config: &InstanceConfig,
    instance_dir: &std::path::Path,
    log: &(dyn Fn(String) + Send + Sync),
) -> io::Result<Option<InstalledJar>> {
    let jar_path = instance_dir.join(managed_jar_name(config.server_type));
    let mc = config
        .minecraft_version
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| http_download::other_err("No Minecraft version is set for this server"))?;

    log(format!("[McAdmin] Looking up Minecraft {mc} in the official version list..."));
    let Some(entry) = catalog.find(mc).await else {
        if jar_path.exists() {
            log(format!(
                "[McAdmin] Minecraft version \"{mc}\" is not an official release (or the version list is unavailable); using the existing server jar."
            ));
            return Ok(None);
        }
        return Err(http_download::other_err(format!(
            "Minecraft version \"{mc}\" is not an official release (or the version list could not be loaded), so its server jar can't be downloaded. Pick an official version or upload a custom jar."
        )));
    };

    let vanilla = mc_versions::vanilla_server_download(&entry).await?;
    let vanilla_path = instance_dir.join(VANILLA_JAR_NAME);
    http_download::download_to_file(
        &vanilla.url,
        &vanilla_path,
        Some(Hash::Sha1(vanilla.sha1.clone())),
        vanilla.size,
        &format!("official Minecraft {mc} server jar"),
        &|l| log(format!("[McAdmin] {l}")),
    )
    .await?;
    log("[McAdmin] Server jar verified (sha1).".to_string());

    match config.server_type {
        ServerType::Fabric => {
            let loader = catalog
                .resolve_fabric_loader(mc, config.loader_version.as_deref())
                .await?;
            let url = catalog.fabric_server_jar_url(mc, &loader).await?;
            http_download::download_to_file(
                &url,
                &jar_path,
                None,
                None,
                &format!("Fabric server launcher (loader {loader})"),
                &|l| log(format!("[McAdmin] {l}")),
            )
            .await?;
            log(format!("[McAdmin] Fabric loader {loader} ready for Minecraft {mc}."));
            Ok(Some(InstalledJar {
                jar_version: format!("{mc}|{loader}"),
                loader_version: Some(loader),
            }))
        }
        _ => Ok(Some(InstalledJar {
            jar_version: format!("{mc}|"),
            loader_version: None,
        })),
    }
}
