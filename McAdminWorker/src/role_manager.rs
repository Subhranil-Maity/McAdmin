use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use tracing::info;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceRole {
    Owner,
    Admin,
    User,
}

impl InstanceRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::User => "user",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstancePermissions {
    pub owner_id: Option<String>,
    #[serde(default)]
    pub admins: Vec<String>,
    #[serde(default)]
    pub users: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolesFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub instances: HashMap<String, InstancePermissions>,
}

fn default_version() -> u32 {
    1
}

impl Default for RolesFile {
    fn default() -> Self {
        Self {
            version: 1,
            instances: HashMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct RoleManager {
    path: PathBuf,
    data: Mutex<RolesFile>,
}

impl RoleManager {
    pub async fn load(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let data = if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&path).await?;
            serde_json::from_str::<RolesFile>(&content).unwrap_or_else(|err| {
                tracing::error!("Failed to parse {}: {err}. Starting with default roles.", path.display());
                RolesFile::default()
            })
        } else {
            let default_data = RolesFile::default();
            write_file(&path, &default_data).await?;
            info!("Created new roles.json at {}", path.display());
            default_data
        };

        Ok(Self {
            path,
            data: Mutex::new(data),
        })
    }

    pub async fn sync_instances(&self, instances: &[crate::instance_config::InstanceConfig]) -> io::Result<()> {
        let mut lock = self.data.lock().await;
        let mut changed = false;

        for inst in instances {
            if !lock.instances.contains_key(&inst.id) {
                lock.instances.insert(
                    inst.id.clone(),
                    InstancePermissions {
                        owner_id: inst.owner_id.clone(),
                        admins: inst.admins.clone(),
                        users: Vec::new(),
                    },
                );
                changed = true;
            }
        }

        if changed {
            write_file(&self.path, &lock).await?;
        }

        Ok(())
    }

    pub async fn get_role(&self, instance_id: &str, user_id: &str) -> Option<InstanceRole> {
        let lock = self.data.lock().await;
        let perms = lock.instances.get(instance_id)?;

        if perms.owner_id.as_deref() == Some(user_id) {
            return Some(InstanceRole::Owner);
        }
        if perms.admins.iter().any(|id| id == user_id) {
            return Some(InstanceRole::Admin);
        }
        if perms.users.iter().any(|id| id == user_id) {
            return Some(InstanceRole::User);
        }

        None
    }

    pub async fn get_permissions(&self, instance_id: &str) -> InstancePermissions {
        let lock = self.data.lock().await;
        lock.instances.get(instance_id).cloned().unwrap_or_default()
    }

    pub async fn init_instance(&self, instance_id: &str, owner_id: Option<String>) -> io::Result<()> {
        let mut lock = self.data.lock().await;
        lock.instances.insert(
            instance_id.to_string(),
            InstancePermissions {
                owner_id,
                admins: Vec::new(),
                users: Vec::new(),
            },
        );
        write_file(&self.path, &lock).await
    }

    pub async fn delete_instance(&self, instance_id: &str) -> io::Result<()> {
        let mut lock = self.data.lock().await;
        if lock.instances.remove(instance_id).is_some() {
            write_file(&self.path, &lock).await?;
        }
        Ok(())
    }

    pub async fn set_owner(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        let perms = lock
            .instances
            .entry(instance_id.to_string())
            .or_default();

        perms.owner_id = Some(user_id.to_string());
        perms.admins.retain(|id| id != user_id);
        perms.users.retain(|id| id != user_id);

        write_file(&self.path, &lock).await.map_err(|e| e.to_string())
    }

    pub async fn add_admin(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        let perms = lock
            .instances
            .entry(instance_id.to_string())
            .or_default();

        if perms.owner_id.as_deref() == Some(user_id) {
            return Err("User is already the owner of this instance.".to_string());
        }

        perms.users.retain(|id| id != user_id);
        if !perms.admins.contains(&user_id.to_string()) {
            perms.admins.push(user_id.to_string());
        }

        write_file(&self.path, &lock).await.map_err(|e| e.to_string())
    }

    pub async fn remove_admin(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        if let Some(perms) = lock.instances.get_mut(instance_id) {
            perms.admins.retain(|id| id != user_id);
            write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn add_user(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        let perms = lock
            .instances
            .entry(instance_id.to_string())
            .or_default();

        if perms.owner_id.as_deref() == Some(user_id) {
            return Err("User is already the owner of this instance.".to_string());
        }

        perms.admins.retain(|id| id != user_id);
        if !perms.users.contains(&user_id.to_string()) {
            perms.users.push(user_id.to_string());
        }

        write_file(&self.path, &lock).await.map_err(|e| e.to_string())
    }

    pub async fn remove_user(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        if let Some(perms) = lock.instances.get_mut(instance_id) {
            perms.users.retain(|id| id != user_id);
            write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn remove_member(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        if let Some(perms) = lock.instances.get_mut(instance_id) {
            perms.admins.retain(|id| id != user_id);
            perms.users.retain(|id| id != user_id);
            write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn transfer_ownership(&self, instance_id: &str, new_owner_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        let perms = lock
            .instances
            .entry(instance_id.to_string())
            .or_default();

        let old_owner = perms.owner_id.take();
        perms.owner_id = Some(new_owner_id.to_string());
        perms.admins.retain(|id| id != new_owner_id);
        perms.users.retain(|id| id != new_owner_id);

        // demote old owner to admin if existing
        if let Some(prev) = old_owner {
            if prev != new_owner_id && !perms.admins.contains(&prev) {
                perms.admins.push(prev);
            }
        }

        write_file(&self.path, &lock).await.map_err(|e| e.to_string())
    }

    pub async fn get_user_instances(&self, user_id: &str) -> Vec<(String, InstanceRole)> {
        let lock = self.data.lock().await;
        let mut result = Vec::new();

        for (id, perms) in &lock.instances {
            if perms.owner_id.as_deref() == Some(user_id) {
                result.push((id.clone(), InstanceRole::Owner));
            } else if perms.admins.iter().any(|uid| uid == user_id) {
                result.push((id.clone(), InstanceRole::Admin));
            } else if perms.users.iter().any(|uid| uid == user_id) {
                result.push((id.clone(), InstanceRole::User));
            }
        }

        result
    }
}

async fn write_file(path: &Path, file: &RolesFile) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let serialized = serde_json::to_string_pretty(file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    tokio::fs::write(path, serialized).await
}
