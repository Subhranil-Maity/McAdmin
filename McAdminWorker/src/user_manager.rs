use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPermissions {
    #[serde(default = "default_true")]
    pub can_create_server: bool,
}

fn default_true() -> bool {
    true
}

impl Default for UserPermissions {
    fn default() -> Self {
        Self {
            can_create_server: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    #[serde(default)]
    pub is_superuser: bool,
    #[serde(default)]
    pub permissions: UserPermissions,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSummary {
    pub id: String,
    pub username: String,
    pub is_superuser: bool,
    pub permissions: UserPermissions,
    pub created_at: String,
}

impl From<&User> for UserSummary {
    fn from(u: &User) -> Self {
        Self {
            id: u.id.clone(),
            username: u.username.clone(),
            is_superuser: u.is_superuser,
            permissions: u.permissions.clone(),
            created_at: u.created_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsersFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub users: Vec<User>,
}

fn default_version() -> u32 {
    1
}

impl Default for UsersFile {
    fn default() -> Self {
        Self {
            version: 1,
            users: Vec::new(),
        }
    }
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Failed to hash password: {e}"))
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(password_hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

#[derive(Debug)]
pub struct UserManager {
    path: PathBuf,
    data: Mutex<UsersFile>,
}

impl UserManager {
    pub async fn load(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let data = if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&path).await?;
            serde_json::from_str::<UsersFile>(&content).unwrap_or_else(|err| {
                tracing::error!("Failed to parse {}: {err}. Starting with empty users.", path.display());
                UsersFile::default()
            })
        } else {
            let default_data = UsersFile::default();
            write_file(&path, &default_data).await?;
            info!("Created new users.json at {}", path.display());
            default_data
        };

        Ok(Self {
            path,
            data: Mutex::new(data),
        })
    }

    pub async fn count(&self) -> usize {
        let lock = self.data.lock().await;
        lock.users.len()
    }

    pub async fn register(
        &self,
        raw_username: &str,
        password: &str,
    ) -> Result<UserSummary, String> {
        let username = raw_username.trim();
        if username.len() < 3 || username.len() > 32 {
            return Err("Username must be between 3 and 32 characters.".to_string());
        }
        if !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err("Username may only contain letters, numbers, hyphens, and underscores.".to_string());
        }
        if password.len() < 6 {
            return Err("Password must be at least 6 characters long.".to_string());
        }

        let mut lock = self.data.lock().await;
        if lock.users.iter().any(|u| u.username.eq_ignore_ascii_case(username)) {
            return Err("Username is already taken.".to_string());
        }

        let is_first_user = lock.users.is_empty();
        let password_hash = hash_password(password)?;

        let user_id = format!("u_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let user = User {
            id: user_id,
            username: username.to_string(),
            password_hash,
            is_superuser: is_first_user,
            permissions: UserPermissions::default(),
            created_at: Utc::now().to_rfc3339(),
        };

        let summary = UserSummary::from(&user);
        lock.users.push(user);
        write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;

        info!(
            "Registered user '{}' (id: {}, superuser: {})",
            summary.username, summary.id, summary.is_superuser
        );

        Ok(summary)
    }

    pub async fn authenticate(
        &self,
        raw_username: &str,
        password: &str,
    ) -> Result<User, String> {
        let username = raw_username.trim();
        let lock = self.data.lock().await;

        let user = lock
            .users
            .iter()
            .find(|u| u.username.eq_ignore_ascii_case(username))
            .ok_or_else(|| "Invalid username or password.".to_string())?;

        if !verify_password(password, &user.password_hash) {
            return Err("Invalid username or password.".to_string());
        }

        Ok(user.clone())
    }

    pub async fn get_user_by_id(&self, id: &str) -> Option<User> {
        let lock = self.data.lock().await;
        lock.users.iter().find(|u| u.id == id).cloned()
    }

    pub async fn get_by_id(&self, id: &str) -> Option<UserSummary> {
        self.get_user_by_id(id).await.map(|u| UserSummary::from(&u))
    }

    pub async fn get_by_username(&self, username: &str) -> Option<UserSummary> {
        let lock = self.data.lock().await;
        lock.users
            .iter()
            .find(|u| u.username.eq_ignore_ascii_case(username.trim()))
            .map(|u| UserSummary::from(u))
    }

    pub async fn list_users(&self) -> Vec<UserSummary> {
        let lock = self.data.lock().await;
        lock.users.iter().map(UserSummary::from).collect()
    }

    pub async fn update_user(
        &self,
        id: &str,
        new_is_superuser: Option<bool>,
        new_permissions: Option<UserPermissions>,
        new_password: Option<String>,
    ) -> Result<UserSummary, String> {
        let mut lock = self.data.lock().await;

        let user_idx = lock
            .users
            .iter()
            .position(|u| u.id == id)
            .ok_or_else(|| "User not found.".to_string())?;

        if let Some(false) = new_is_superuser {
            if lock.users[user_idx].is_superuser {
                let superuser_count = lock.users.iter().filter(|u| u.is_superuser).count();
                if superuser_count <= 1 {
                    return Err("Cannot revoke superuser status from the only superuser.".to_string());
                }
            }
        }

        if let Some(is_super) = new_is_superuser {
            lock.users[user_idx].is_superuser = is_super;
        }

        if let Some(perms) = new_permissions {
            lock.users[user_idx].permissions = perms;
        }

        if let Some(pass) = new_password {
            if pass.len() < 6 {
                return Err("Password must be at least 6 characters long.".to_string());
            }
            let hash = hash_password(&pass)?;
            lock.users[user_idx].password_hash = hash;
        }

        let updated = UserSummary::from(&lock.users[user_idx]);
        write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;

        Ok(updated)
    }

    pub async fn delete_user(&self, id: &str) -> Result<(), String> {
        let mut lock = self.data.lock().await;

        let user = lock
            .users
            .iter()
            .find(|u| u.id == id)
            .ok_or_else(|| "User not found.".to_string())?;

        if user.is_superuser {
            let superuser_count = lock.users.iter().filter(|u| u.is_superuser).count();
            if superuser_count <= 1 {
                return Err("Cannot delete the only superuser.".to_string());
            }
        }

        lock.users.retain(|u| u.id != id);
        write_file(&self.path, &lock).await.map_err(|e| e.to_string())?;

        Ok(())
    }
}

async fn write_file(path: &Path, file: &UsersFile) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let serialized = serde_json::to_string_pretty(file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    tokio::fs::write(path, serialized).await
}
