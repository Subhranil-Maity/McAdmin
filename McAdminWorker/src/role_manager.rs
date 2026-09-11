use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use tracing::info;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ServerStart,
    ServerStop,
    ServerRestart,
    ServerPower,
    LogsView,
    ConsoleSend,
    PlayersView,
    PlayersKick,
    PlayersBan,
    PlayersOp,
    WhitelistView,
    WhitelistManage,
    FilesRead,
    FilesEdit,
    FilesUpload,
    FilesDelete,
    PropertiesView,
    PropertiesEdit,
    MembersManage,
}

impl Permission {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ServerStart => "server:start",
            Self::ServerStop => "server:stop",
            Self::ServerRestart => "server:restart",
            Self::ServerPower => "server:power",
            Self::LogsView => "logs:view",
            Self::ConsoleSend => "console:send",
            Self::PlayersView => "players:view",
            Self::PlayersKick => "players:kick",
            Self::PlayersBan => "players:ban",
            Self::PlayersOp => "players:op",
            Self::WhitelistView => "whitelist:view",
            Self::WhitelistManage => "whitelist:manage",
            Self::FilesRead => "files:read",
            Self::FilesEdit => "files:edit",
            Self::FilesUpload => "files:upload",
            Self::FilesDelete => "files:delete",
            Self::PropertiesView => "properties:view",
            Self::PropertiesEdit => "properties:edit",
            Self::MembersManage => "members:manage",
        }
    }
}

pub mod perm {
    use super::Permission;

    pub mod server {
        use super::Permission;
        pub const START: Permission = Permission::ServerStart;
        pub const STOP: Permission = Permission::ServerStop;
        pub const RESTART: Permission = Permission::ServerRestart;
        pub const POWER: Permission = Permission::ServerPower;
    }
    pub mod logs {
        use super::Permission;
        pub const VIEW: Permission = Permission::LogsView;
    }
    pub mod console {
        use super::Permission;
        pub const SEND: Permission = Permission::ConsoleSend;
    }
    pub mod players {
        use super::Permission;
        pub const VIEW: Permission = Permission::PlayersView;
        pub const KICK: Permission = Permission::PlayersKick;
        pub const BAN: Permission = Permission::PlayersBan;
        pub const OP: Permission = Permission::PlayersOp;
    }
    pub mod whitelist {
        use super::Permission;
        pub const VIEW: Permission = Permission::WhitelistView;
        pub const MANAGE: Permission = Permission::WhitelistManage;
    }
    pub mod files {
        use super::Permission;
        pub const READ: Permission = Permission::FilesRead;
        pub const EDIT: Permission = Permission::FilesEdit;
        pub const UPLOAD: Permission = Permission::FilesUpload;
        pub const DELETE: Permission = Permission::FilesDelete;
    }
    pub mod properties {
        use super::Permission;
        pub const VIEW: Permission = Permission::PropertiesView;
        pub const EDIT: Permission = Permission::PropertiesEdit;
    }
    pub mod members {
        use super::Permission;
        pub const MANAGE: Permission = Permission::MembersManage;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerPermissions {
    #[serde(default)]
    pub server_start: bool,
    #[serde(default)]
    pub server_stop: bool,
    #[serde(default)]
    pub server_restart: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_power: Option<bool>,
    #[serde(default)]
    pub logs_view: bool,
    #[serde(default)]
    pub console_send: bool,
    #[serde(default)]
    pub players_view: bool,
    #[serde(default)]
    pub players_kick: bool,
    #[serde(default)]
    pub players_ban: bool,
    #[serde(default)]
    pub players_op: bool,
    #[serde(default)]
    pub whitelist_view: bool,
    #[serde(default)]
    pub whitelist_manage: bool,
    #[serde(default)]
    pub files_read: bool,
    #[serde(default)]
    pub files_edit: bool,
    #[serde(default)]
    pub files_upload: bool,
    #[serde(default)]
    pub files_delete: bool,
    #[serde(default)]
    pub properties_view: bool,
    #[serde(default)]
    pub properties_edit: bool,
    #[serde(default)]
    pub members_manage: bool,
}

impl Default for ServerPermissions {
    fn default() -> Self {
        Self::viewer()
    }
}

impl ServerPermissions {
    pub fn has(&self, permission: Permission) -> bool {
        match permission {
            Permission::ServerStart => self.server_start || self.server_power.unwrap_or(false),
            Permission::ServerStop => self.server_stop || self.server_power.unwrap_or(false),
            Permission::ServerRestart => self.server_restart || self.server_power.unwrap_or(false),
            Permission::ServerPower => {
                self.server_power.unwrap_or(false)
                    || (self.server_start && self.server_stop && self.server_restart)
            }
            Permission::LogsView => self.logs_view,
            Permission::ConsoleSend => self.console_send,
            Permission::PlayersView => self.players_view,
            Permission::PlayersKick => self.players_kick,
            Permission::PlayersBan => self.players_ban,
            Permission::PlayersOp => self.players_op,
            Permission::WhitelistView => self.whitelist_view,
            Permission::WhitelistManage => self.whitelist_manage,
            Permission::FilesRead => self.files_read,
            Permission::FilesEdit => self.files_edit,
            Permission::FilesUpload => self.files_upload,
            Permission::FilesDelete => self.files_delete,
            Permission::PropertiesView => self.properties_view,
            Permission::PropertiesEdit => self.properties_edit,
            Permission::MembersManage => self.members_manage,
        }
    }

    pub fn all() -> Self {
        Self {
            server_start: true,
            server_stop: true,
            server_restart: true,
            server_power: None,
            logs_view: true,
            console_send: true,
            players_view: true,
            players_kick: true,
            players_ban: true,
            players_op: true,
            whitelist_view: true,
            whitelist_manage: true,
            files_read: true,
            files_edit: true,
            files_upload: true,
            files_delete: true,
            properties_view: true,
            properties_edit: true,
            members_manage: true,
        }
    }

    pub fn none() -> Self {
        Self {
            server_start: false,
            server_stop: false,
            server_restart: false,
            server_power: None,
            logs_view: false,
            console_send: false,
            players_view: false,
            players_kick: false,
            players_ban: false,
            players_op: false,
            whitelist_view: false,
            whitelist_manage: false,
            files_read: false,
            files_edit: false,
            files_upload: false,
            files_delete: false,
            properties_view: false,
            properties_edit: false,
            members_manage: false,
        }
    }

    pub fn admin() -> Self {
        Self::all()
    }

    pub fn moderator() -> Self {
        Self {
            server_start: true,
            server_stop: true,
            server_restart: true,
            server_power: None,
            logs_view: true,
            console_send: true,
            players_view: true,
            players_kick: true,
            players_ban: true,
            players_op: false,
            whitelist_view: true,
            whitelist_manage: true,
            files_read: false,
            files_edit: false,
            files_upload: false,
            files_delete: false,
            properties_view: false,
            properties_edit: false,
            members_manage: false,
        }
    }

    pub fn viewer() -> Self {
        Self {
            server_start: false,
            server_stop: false,
            server_restart: false,
            server_power: None,
            logs_view: true,
            console_send: false,
            players_view: true,
            players_kick: false,
            players_ban: false,
            players_op: false,
            whitelist_view: true,
            whitelist_manage: false,
            files_read: true,
            files_edit: false,
            files_upload: false,
            files_delete: false,
            properties_view: true,
            properties_edit: false,
            members_manage: false,
        }
    }

    pub fn from_role_name(role: &str) -> Self {
        match role.to_lowercase().as_str() {
            "admin" => Self::admin(),
            "moderator" => Self::moderator(),
            "viewer" | "user" => Self::viewer(),
            _ => Self::viewer(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberAssignment {
    pub user_id: String,
    pub role_name: String,
    pub permissions: ServerPermissions,
}

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
    #[serde(default)]
    pub members: HashMap<String, MemberAssignment>,
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
                let mut members = HashMap::new();
                for admin_id in &inst.admins {
                    members.insert(
                        admin_id.clone(),
                        MemberAssignment {
                            user_id: admin_id.clone(),
                            role_name: "admin".to_string(),
                            permissions: ServerPermissions::admin(),
                        },
                    );
                }

                lock.instances.insert(
                    inst.id.clone(),
                    InstancePermissions {
                        owner_id: inst.owner_id.clone(),
                        admins: inst.admins.clone(),
                        users: Vec::new(),
                        members,
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
        if let Some(m) = perms.members.get(user_id) {
            if m.role_name == "admin" || m.permissions.members_manage {
                return Some(InstanceRole::Admin);
            } else {
                return Some(InstanceRole::User);
            }
        }
        if perms.admins.iter().any(|id| id == user_id) {
            return Some(InstanceRole::Admin);
        }
        if perms.users.iter().any(|id| id == user_id) {
            return Some(InstanceRole::User);
        }

        None
    }

    pub async fn get_user_permissions(&self, instance_id: &str, user_id: &str) -> (String, ServerPermissions) {
        let lock = self.data.lock().await;
        let perms = match lock.instances.get(instance_id) {
            Some(p) => p,
            None => return ("none".to_string(), ServerPermissions::none()),
        };

        if perms.owner_id.as_deref() == Some(user_id) {
            return ("owner".to_string(), ServerPermissions::all());
        }

        if let Some(m) = perms.members.get(user_id) {
            return (m.role_name.clone(), m.permissions);
        }

        if perms.admins.iter().any(|id| id == user_id) {
            return ("admin".to_string(), ServerPermissions::admin());
        }

        if perms.users.iter().any(|id| id == user_id) {
            return ("viewer".to_string(), ServerPermissions::viewer());
        }

        ("none".to_string(), ServerPermissions::none())
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
                members: HashMap::new(),
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
        perms.members.remove(user_id);

        write_file(&self.path, &lock).await.map_err(|e| e.to_string())
    }

    pub async fn set_member_permissions(
        &self,
        instance_id: &str,
        user_id: &str,
        role: &str,
        permissions: ServerPermissions,
    ) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        let perms = lock
            .instances
            .entry(instance_id.to_string())
            .or_default();

        if perms.owner_id.as_deref() == Some(user_id) {
            return Err("User is already the owner of this instance.".to_string());
        }

        let is_admin_role = role.eq_ignore_ascii_case("admin") || (permissions == ServerPermissions::admin());

        perms.members.insert(
            user_id.to_string(),
            MemberAssignment {
                user_id: user_id.to_string(),
                role_name: role.to_string(),
                permissions,
            },
        );

        if is_admin_role {
            perms.users.retain(|id| id != user_id);
            if !perms.admins.contains(&user_id.to_string()) {
                perms.admins.push(user_id.to_string());
            }
        } else {
            perms.admins.retain(|id| id != user_id);
            if !perms.users.contains(&user_id.to_string()) {
                perms.users.push(user_id.to_string());
            }
        }

        write_file(&self.path, &lock).await.map_err(|e| e.to_string())
    }

    pub async fn add_admin(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        self.set_member_permissions(instance_id, user_id, "admin", ServerPermissions::admin()).await
    }

    pub async fn remove_admin(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        if let Some(perms) = lock.instances.get_mut(instance_id) {
            perms.admins.retain(|id| id != user_id);
            perms.members.remove(user_id);
            write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn add_user(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        self.set_member_permissions(instance_id, user_id, "viewer", ServerPermissions::viewer()).await
    }

    pub async fn remove_user(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        if let Some(perms) = lock.instances.get_mut(instance_id) {
            perms.users.retain(|id| id != user_id);
            perms.members.remove(user_id);
            write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn remove_member(&self, instance_id: &str, user_id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;
        if let Some(perms) = lock.instances.get_mut(instance_id) {
            perms.admins.retain(|id| id != user_id);
            perms.users.retain(|id| id != user_id);
            perms.members.remove(user_id);
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
        perms.members.remove(new_owner_id);

        // demote old owner to admin if existing
        if let Some(prev) = old_owner {
            if prev != new_owner_id {
                if !perms.admins.contains(&prev) {
                    perms.admins.push(prev.clone());
                }
                perms.members.insert(
                    prev.clone(),
                    MemberAssignment {
                        user_id: prev,
                        role_name: "admin".to_string(),
                        permissions: ServerPermissions::admin(),
                    },
                );
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
            } else if let Some(m) = perms.members.get(user_id) {
                if m.role_name == "admin" || m.permissions.members_manage {
                    result.push((id.clone(), InstanceRole::Admin));
                } else {
                    result.push((id.clone(), InstanceRole::User));
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_str_mapping() {
        assert_eq!(Permission::ServerStart.as_str(), "server:start");
        assert_eq!(Permission::ServerStop.as_str(), "server:stop");
        assert_eq!(Permission::ServerRestart.as_str(), "server:restart");
        assert_eq!(Permission::ServerPower.as_str(), "server:power");
    }

    #[test]
    fn test_server_power_split_presets() {
        let admin = ServerPermissions::admin();
        assert!(admin.has(Permission::ServerStart));
        assert!(admin.has(Permission::ServerStop));
        assert!(admin.has(Permission::ServerRestart));
        assert!(admin.has(Permission::ServerPower));

        let mod_perms = ServerPermissions::moderator();
        assert!(mod_perms.has(Permission::ServerStart));
        assert!(mod_perms.has(Permission::ServerStop));
        assert!(mod_perms.has(Permission::ServerRestart));

        let viewer = ServerPermissions::viewer();
        assert!(!viewer.has(Permission::ServerStart));
        assert!(!viewer.has(Permission::ServerStop));
        assert!(!viewer.has(Permission::ServerRestart));

        // Test custom: only restart
        let only_restart = ServerPermissions {
            server_restart: true,
            ..ServerPermissions::none()
        };
        assert!(!only_restart.has(Permission::ServerStart));
        assert!(!only_restart.has(Permission::ServerStop));
        assert!(only_restart.has(Permission::ServerRestart));

        // Test backward compatibility with legacy server_power
        let legacy_json = r#"{"server_power": true}"#;
        let deserialized: ServerPermissions = serde_json::from_str(legacy_json).unwrap();
        assert!(deserialized.has(Permission::ServerStart));
        assert!(deserialized.has(Permission::ServerStop));
        assert!(deserialized.has(Permission::ServerRestart));
    }
}
