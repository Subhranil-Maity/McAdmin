use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use tracing::info;

pub const DEFAULT_SERVER_PORT: u16 = 25565;
pub const DEFAULT_RCON_PORT: u16 = 25575;
pub const DEFAULT_RAM_GB: u32 = 2;
pub const DEFAULT_JAR_NAME: &str = "server.jar";

/// How the server jar is provided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerType {
    /// Official Mojang server jar, downloaded by the worker.
    Vanilla,
    /// Fabric server launcher, downloaded by the worker.
    Fabric,
    /// User-uploaded jar (the default, so pre-existing instances keep working).
    #[default]
    Custom,
}

impl ServerType {
    pub fn is_managed(self) -> bool {
        !matches!(self, ServerType::Custom)
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "vanilla" | "official" => Some(Self::Vanilla),
            "fabric" => Some(Self::Fabric),
            "custom" | "" => Some(Self::Custom),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub folder: String,
    #[serde(default = "default_jar_name")]
    pub jar_name: String,
    #[serde(default = "default_server_port")]
    pub server_port: u16,
    #[serde(default = "default_rcon_port")]
    pub rcon_port: u16,
    #[serde(default = "default_rcon_password")]
    pub rcon_password: String,
    #[serde(default = "default_ram_gb")]
    pub ram_gb: u32,
    #[serde(default, alias = "version")]
    pub minecraft_version: Option<String>,
    #[serde(default)]
    pub java_runtime: Option<String>,
    #[serde(default)]
    pub server_type: ServerType,
    /// Fabric loader version (Fabric instances only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    /// `<minecraft_version>|<loader_version>` the current managed jar was downloaded for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_jar_version: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub admins: Vec<String>,
}

fn default_jar_name() -> String {
    DEFAULT_JAR_NAME.to_string()
}

fn default_server_port() -> u16 {
    DEFAULT_SERVER_PORT
}

fn default_rcon_port() -> u16 {
    DEFAULT_RCON_PORT
}

fn default_ram_gb() -> u32 {
    DEFAULT_RAM_GB
}

fn default_rcon_password() -> String {
    format!("rcon_{}", uuid::Uuid::new_v4().simple())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub instances: Vec<InstanceConfig>,
}

fn default_version() -> u32 {
    1
}

impl Default for McConfig {
    fn default() -> Self {
        Self {
            version: 1,
            instances: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct McConfigManager {
    path: PathBuf,
    config: Mutex<McConfig>,
}

impl McConfigManager {
    pub async fn load(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let config = if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&path).await?;
            serde_json::from_str::<McConfig>(&content).unwrap_or_else(|err| {
                tracing::error!("Failed to parse {}: {err}. Starting with default config.", path.display());
                McConfig::default()
            })
        } else {
            let default_config = McConfig::default();
            write_config_file(&path, &default_config).await?;
            info!("Created new mc_config.json at {}", path.display());
            default_config
        };

        Ok(Self {
            path,
            config: Mutex::new(config),
        })
    }

    pub async fn save_locked(path: &Path, config: &McConfig) -> io::Result<()> {
        write_config_file(path, config).await
    }

    pub async fn list_instances(&self) -> Vec<InstanceConfig> {
        let lock = self.config.lock().await;
        lock.instances.clone()
    }

    pub async fn get_instance(&self, id: &str) -> Option<InstanceConfig> {
        let lock = self.config.lock().await;
        lock.instances.iter().find(|i| i.id == id).cloned()
    }

    pub async fn add_instance(&self, instance: InstanceConfig) -> io::Result<()> {
        let mut lock = self.config.lock().await;
        lock.instances.retain(|i| i.id != instance.id);
        lock.instances.push(instance);
        Self::save_locked(&self.path, &lock).await
    }

    pub async fn remove_instance(&self, id: &str) -> io::Result<Option<InstanceConfig>> {
        let mut lock = self.config.lock().await;
        let pos = lock.instances.iter().position(|i| i.id == id);
        if let Some(index) = pos {
            let removed = lock.instances.remove(index);
            Self::save_locked(&self.path, &lock).await?;
            Ok(Some(removed))
        } else {
            Ok(None)
        }
    }

    /// Applies `f` to an instance and persists the config.
    pub async fn update_with(
        &self,
        id: &str,
        f: impl FnOnce(&mut InstanceConfig),
    ) -> io::Result<Option<InstanceConfig>> {
        let mut lock = self.config.lock().await;
        if let Some(instance) = lock.instances.iter_mut().find(|i| i.id == id) {
            f(instance);
            let updated = instance.clone();
            Self::save_locked(&self.path, &lock).await?;
            Ok(Some(updated))
        } else {
            Ok(None)
        }
    }

    pub async fn update_instance_admins(
        &self,
        id: &str,
        admins: Vec<String>,
    ) -> io::Result<Option<InstanceConfig>> {
        let mut lock = self.config.lock().await;
        if let Some(instance) = lock.instances.iter_mut().find(|i| i.id == id) {
            instance.admins = admins;
            let updated = instance.clone();
            Self::save_locked(&self.path, &lock).await?;
            Ok(Some(updated))
        } else {
            Ok(None)
        }
    }

    pub async fn update_instance_config(
        &self,
        id: &str,
        ram_gb: Option<u32>,
        minecraft_version: Option<String>,
        name: Option<String>,
        java_runtime: Option<String>,
        loader_version: Option<String>,
    ) -> io::Result<Option<InstanceConfig>> {
        let mut lock = self.config.lock().await;
        if let Some(instance) = lock.instances.iter_mut().find(|i| i.id == id) {
            if let Some(ram) = ram_gb {
                instance.ram_gb = ram;
            }
            if let Some(ver) = minecraft_version {
                let trimmed = ver.trim();
                instance.minecraft_version = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            if let Some(n) = name {
                let trimmed = n.trim();
                if !trimmed.is_empty() {
                    instance.name = trimmed.to_string();
                }
            }
            if let Some(jr) = java_runtime {
                let trimmed = jr.trim();
                instance.java_runtime = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            if let Some(lv) = loader_version {
                let trimmed = lv.trim();
                instance.loader_version = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            let updated = instance.clone();
            Self::save_locked(&self.path, &lock).await?;
            Ok(Some(updated))
        } else {
            Ok(None)
        }
    }

    pub async fn allocate_ports(
        &self,
        preferred_server: Option<u16>,
        preferred_rcon: Option<u16>,
    ) -> (u16, u16) {
        let lock = self.config.lock().await;
        let used_server_ports: std::collections::HashSet<u16> =
            lock.instances.iter().map(|i| i.server_port).collect();
        let used_rcon_ports: std::collections::HashSet<u16> =
            lock.instances.iter().map(|i| i.rcon_port).collect();

        let server_port = match preferred_server {
            Some(p) if !used_server_ports.contains(&p) => p,
            _ => {
                let mut candidate = DEFAULT_SERVER_PORT;
                while used_server_ports.contains(&candidate) {
                    candidate += 1;
                }
                candidate
            }
        };

        let rcon_port = match preferred_rcon {
            Some(p) if !used_rcon_ports.contains(&p) => p,
            _ => {
                let mut candidate = DEFAULT_RCON_PORT;
                while used_rcon_ports.contains(&candidate) {
                    candidate += 1;
                }
                candidate
            }
        };

        (server_port, rcon_port)
    }
}

async fn write_config_file(path: &Path, config: &McConfig) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("failed to serialize mc_config.json: {e}"),
        )
    })?;
    tokio::fs::write(path, content).await
}

impl InstanceConfig {
    /// Identifier of the managed jar this config wants (`<mc>|<loader>`).
    pub fn wanted_jar_version(&self) -> Option<String> {
        let mc = self.minecraft_version.as_deref()?.trim();
        if mc.is_empty() {
            return None;
        }
        Some(match self.server_type {
            ServerType::Fabric => format!("{mc}|{}", self.loader_version.as_deref().unwrap_or("")),
            _ => format!("{mc}|"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_configs_default_to_custom() {
        let json = r#"{"version":1,"instances":[{"id":"a","name":"Old","folder":"instances/a",
            "jar_name":"paper.jar","server_port":25565,"rcon_port":25575,"rcon_password":"x",
            "ram_gb":4,"minecraft_version":"whatever-1.0","created_at":"2026-01-01T00:00:00Z"}]}"#;
        let cfg: McConfig = serde_json::from_str(json).unwrap();
        let inst = &cfg.instances[0];
        assert_eq!(inst.server_type, ServerType::Custom);
        assert_eq!(inst.jar_name, "paper.jar");
        assert!(inst.loader_version.is_none());
        assert!(inst.installed_jar_version.is_none());
    }

    #[test]
    fn parses_server_types() {
        assert_eq!(ServerType::parse("Vanilla"), Some(ServerType::Vanilla));
        assert_eq!(ServerType::parse("official"), Some(ServerType::Vanilla));
        assert_eq!(ServerType::parse("fabric"), Some(ServerType::Fabric));
        assert_eq!(ServerType::parse(""), Some(ServerType::Custom));
        assert_eq!(ServerType::parse("forge"), None);
    }
}
