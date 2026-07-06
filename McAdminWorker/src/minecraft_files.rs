use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::Path;
use tokio::fs;
use tracing::warn;

pub(crate) const USER_CACHE_FILE: &str = "usercache.json";
pub(crate) const OPS_FILE: &str = "ops.json";
pub(crate) const WHITELIST_FILE: &str = "whitelist.json";
pub(crate) const BANNED_PLAYERS_FILE: &str = "banned-players.json";

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct UserCacheEntry {
    pub(crate) name: String,
    pub(crate) uuid: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub(crate) struct OpEntry {
    pub(crate) uuid: String,
    pub(crate) name: String,
    pub(crate) level: i32,
    #[serde(default)]
    pub(crate) bypasses_player_limit: bool,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub(crate) struct WhitelistEntry {
    pub(crate) uuid: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub(crate) struct BannedPlayerEntry {
    pub(crate) uuid: String,
    pub(crate) name: String,
    pub(crate) created: String,
    pub(crate) source: String,
    pub(crate) expires: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

async fn read_array<T: DeserializeOwned>(path: &Path) -> Vec<T> {
    let content = match fs::read_to_string(path).await {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(e) => {
            warn!("failed to read {}: {e}", path.display());
            return Vec::new();
        }
    };
    serde_json::from_str(&content).unwrap_or_else(|e| {
        warn!("failed to parse {}: {e}", path.display());
        Vec::new()
    })
}

async fn write_array<T: Serialize>(path: &Path, data: &[T]) -> Result<(), std::io::Error> {
    let content = serde_json::to_string_pretty(data)?;
    fs::write(path, content).await?;
    Ok(())
}

pub(crate) async fn read_usercache(server_dir: &Path) -> Vec<UserCacheEntry> {
    read_array(&server_dir.join(USER_CACHE_FILE)).await
}

pub(crate) async fn read_ops(server_dir: &Path) -> Vec<OpEntry> {
    read_array(&server_dir.join(OPS_FILE)).await
}

pub(crate) async fn write_ops(
    server_dir: &Path,
    data: &[OpEntry],
) -> Result<(), std::io::Error> {
    write_array(&server_dir.join(OPS_FILE), data).await
}

pub(crate) async fn read_whitelist_json(server_dir: &Path) -> Vec<WhitelistEntry> {
    read_array(&server_dir.join(WHITELIST_FILE)).await
}

pub(crate) async fn write_whitelist_json(
    server_dir: &Path,
    data: &[WhitelistEntry],
) -> Result<(), std::io::Error> {
    write_array(&server_dir.join(WHITELIST_FILE), data).await
}

pub(crate) async fn read_banned_players(server_dir: &Path) -> Vec<BannedPlayerEntry> {
    read_array(&server_dir.join(BANNED_PLAYERS_FILE)).await
}

pub(crate) async fn write_banned_players(
    server_dir: &Path,
    data: &[BannedPlayerEntry],
) -> Result<(), std::io::Error> {
    write_array(&server_dir.join(BANNED_PLAYERS_FILE), data).await
}

pub(crate) async fn find_uuid_in_cache(server_dir: &Path, name: &str) -> Option<String> {
    let cache = read_usercache(server_dir).await;
    cache.iter().find(|e| e.name.eq_ignore_ascii_case(name)).map(|e| e.uuid.clone())
}
