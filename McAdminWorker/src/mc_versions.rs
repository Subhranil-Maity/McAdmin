//! Official Minecraft version catalogue (Mojang launcher manifest) and Fabric meta.
//!
//! A version string is `Official` only if it appears in Mojang's manifest; anything
//! else is `Unknown` — allowed everywhere, it just can't be auto-downloaded. The
//! manifest is cached in memory and on disk (`$HOME_DIR/cache/version_manifest.json`),
//! so a stale or unreachable list never breaks existing instances.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};
use tracing::{info, warn};

use crate::http_download::{client, other_err};

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
/// How long a successfully fetched manifest is considered fresh.
const MANIFEST_TTL: Duration = Duration::from_secs(60 * 60);
/// Minimum delay between fetch attempts after a failure (or a forced refresh).
const RETRY_BACKOFF: Duration = Duration::from_secs(30);
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const FABRIC_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(rename = "releaseTime", default)]
    pub release_time: String,
    #[serde(default)]
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Latest {
    #[serde(default)]
    pub release: String,
    #[serde(default)]
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub latest: Latest,
    #[serde(default)]
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Fetched from Mojang during this process's lifetime and still fresh.
    Live,
    /// Loaded from the on-disk cache (or a stale in-memory copy).
    Cache,
    /// No version list available at all.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionStatus {
    Official,
    Unknown,
}

pub struct CatalogSnapshot {
    pub manifest: Option<Manifest>,
    pub source: Source,
    pub fetched_at: Option<DateTime<Utc>>,
}

struct Loaded {
    manifest: Manifest,
    fetched_at: Option<DateTime<Utc>>,
    /// Set when the manifest came from Mojang in this process.
    live_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricVersion {
    pub version: String,
    pub stable: bool,
}

#[derive(Deserialize)]
struct FabricLoaderEntry {
    loader: FabricVersion,
}

#[derive(Deserialize)]
struct CachedDisk {
    fetched_at: Option<DateTime<Utc>>,
    manifest: Manifest,
}

pub struct VersionCatalog {
    cache_path: PathBuf,
    loaded: RwLock<Option<Loaded>>,
    /// Serializes fetches; holds the time of the last attempt.
    fetch_gate: Mutex<Option<Instant>>,
    fabric_cache: Mutex<HashMap<String, (Instant, serde_json::Value)>>,
}

impl VersionCatalog {
    pub async fn new(home: &Path) -> Self {
        let cache_path = home.join("cache").join("version_manifest.json");
        let loaded = match tokio::fs::read_to_string(&cache_path).await {
            Ok(text) => match serde_json::from_str::<CachedDisk>(&text) {
                Ok(disk) => Some(Loaded {
                    manifest: disk.manifest,
                    fetched_at: disk.fetched_at,
                    live_at: None,
                }),
                Err(e) => {
                    warn!(
                        "Ignoring unreadable version cache {}: {e}",
                        cache_path.display()
                    );
                    None
                }
            },
            Err(_) => None,
        };
        Self {
            cache_path,
            loaded: RwLock::new(loaded),
            fetch_gate: Mutex::new(None),
            fabric_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Current catalogue, refreshing from Mojang if stale. `force` bypasses the TTL
    /// (still subject to a short backoff). Never fails: falls back to the cache.
    pub async fn snapshot(&self, force: bool) -> CatalogSnapshot {
        if force || !self.is_fresh().await {
            self.try_refresh(force).await;
        }
        self.cached_snapshot().await
    }

    /// Catalogue without any network access.
    pub async fn cached_snapshot(&self) -> CatalogSnapshot {
        let lock = self.loaded.read().await;
        match lock.as_ref() {
            Some(l) => CatalogSnapshot {
                manifest: Some(l.manifest.clone()),
                source: if l.live_at.is_some_and(|t| t.elapsed() < MANIFEST_TTL) {
                    Source::Live
                } else {
                    Source::Cache
                },
                fetched_at: l.fetched_at,
            },
            None => CatalogSnapshot {
                manifest: None,
                source: Source::None,
                fetched_at: None,
            },
        }
    }

    async fn is_fresh(&self) -> bool {
        let lock = self.loaded.read().await;
        lock.as_ref()
            .and_then(|l| l.live_at)
            .is_some_and(|t| t.elapsed() < MANIFEST_TTL)
    }

    async fn try_refresh(&self, force: bool) {
        let mut gate = self.fetch_gate.lock().await;
        // Another caller may have refreshed while we waited for the gate.
        if !force && self.is_fresh().await {
            return;
        }
        if gate.is_some_and(|t| t.elapsed() < RETRY_BACKOFF) {
            return;
        }
        *gate = Some(Instant::now());

        match fetch_manifest().await {
            Ok(manifest) => {
                let fetched_at = Utc::now();
                info!(
                    "Fetched Minecraft version manifest ({} versions, latest release {})",
                    manifest.versions.len(),
                    manifest.latest.release
                );
                if let Err(e) = self.write_disk_cache(&manifest, fetched_at).await {
                    warn!("Failed to write version cache: {e}");
                }
                *self.loaded.write().await = Some(Loaded {
                    manifest,
                    fetched_at: Some(fetched_at),
                    live_at: Some(Instant::now()),
                });
            }
            Err(e) => warn!("Could not refresh Minecraft version manifest: {e}"),
        }
    }

    async fn write_disk_cache(
        &self,
        manifest: &Manifest,
        fetched_at: DateTime<Utc>,
    ) -> io::Result<()> {
        if let Some(parent) = self.cache_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let body = serde_json::json!({ "fetched_at": fetched_at, "manifest": manifest });
        let tmp = self.cache_path.with_extension("json.tmp");
        tokio::fs::write(&tmp, serde_json::to_vec(&body)?).await?;
        tokio::fs::rename(&tmp, &self.cache_path).await
    }

    /// Looks up an official version. If it isn't in the (possibly stale) list,
    /// tries one refresh so newly released versions are recognized.
    pub async fn find(&self, version: &str) -> Option<VersionEntry> {
        let version = version.trim();
        if version.is_empty() {
            return None;
        }
        let snap = self.snapshot(false).await;
        if let Some(entry) = lookup(snap.manifest.as_ref(), version) {
            return Some(entry);
        }
        if snap.source != Source::Live {
            let snap = self.snapshot(true).await;
            return lookup(snap.manifest.as_ref(), version);
        }
        None
    }

    /// Classification without network access (for listings).
    pub async fn status_cached(&self, version: Option<&str>) -> VersionStatus {
        let Some(version) = version.map(str::trim).filter(|v| !v.is_empty()) else {
            return VersionStatus::Unknown;
        };
        let lock = self.loaded.read().await;
        match lock.as_ref() {
            Some(l) if l.manifest.versions.iter().any(|v| v.id == version) => {
                VersionStatus::Official
            }
            _ => VersionStatus::Unknown,
        }
    }

    async fn fabric_get(&self, path: &str) -> io::Result<serde_json::Value> {
        {
            let cache = self.fabric_cache.lock().await;
            if let Some((at, value)) = cache.get(path) {
                if at.elapsed() < FABRIC_TTL {
                    return Ok(value.clone());
                }
            }
        }
        let value: serde_json::Value = client()
            .get(format!("{FABRIC_META}{path}"))
            .timeout(FETCH_TIMEOUT)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| other_err(format!("Fabric meta request failed: {e}")))?
            .json()
            .await
            .map_err(|e| other_err(format!("Invalid Fabric meta response: {e}")))?;
        self.fabric_cache
            .lock()
            .await
            .insert(path.to_string(), (Instant::now(), value.clone()));
        Ok(value)
    }

    /// Minecraft versions Fabric supports.
    pub async fn fabric_games(&self) -> io::Result<Vec<FabricVersion>> {
        let v = self.fabric_get("/versions/game").await?;
        serde_json::from_value(v).map_err(|e| other_err(e.to_string()))
    }

    /// Fabric loader versions available for a Minecraft version (newest first).
    pub async fn fabric_loaders(&self, game: &str) -> io::Result<Vec<FabricVersion>> {
        let v = self
            .fabric_get(&format!("/versions/loader/{}", urlencode(game)))
            .await?;
        let entries: Vec<FabricLoaderEntry> =
            serde_json::from_value(v).map_err(|e| other_err(e.to_string()))?;
        Ok(entries.into_iter().map(|e| e.loader).collect())
    }

    async fn fabric_latest_installer(&self) -> io::Result<String> {
        let v = self.fabric_get("/versions/installer").await?;
        let list: Vec<FabricVersion> =
            serde_json::from_value(v).map_err(|e| other_err(e.to_string()))?;
        list.iter()
            .find(|i| i.stable)
            .or(list.first())
            .map(|i| i.version.clone())
            .ok_or_else(|| other_err("No Fabric installer versions available"))
    }

    /// Picks the loader to use: the requested one if valid, else the latest stable.
    pub async fn resolve_fabric_loader(
        &self,
        game: &str,
        requested: Option<&str>,
    ) -> io::Result<String> {
        let loaders = self.fabric_loaders(game).await?;
        if loaders.is_empty() {
            return Err(other_err(format!(
                "Fabric does not support Minecraft {game}"
            )));
        }
        if let Some(req) = requested.map(str::trim).filter(|s| !s.is_empty()) {
            return loaders
                .iter()
                .find(|l| l.version == req)
                .map(|l| l.version.clone())
                .ok_or_else(|| {
                    other_err(format!(
                        "Fabric loader {req} is not available for Minecraft {game}"
                    ))
                });
        }
        Ok(loaders
            .iter()
            .find(|l| l.stable)
            .unwrap_or(&loaders[0])
            .version
            .clone())
    }

    /// URL of the Fabric server launcher jar for a game + loader version.
    pub async fn fabric_server_jar_url(&self, game: &str, loader: &str) -> io::Result<String> {
        let installer = self.fabric_latest_installer().await?;
        Ok(format!(
            "{FABRIC_META}/versions/loader/{}/{}/{}/server/jar",
            urlencode(game),
            urlencode(loader),
            urlencode(&installer)
        ))
    }
}

#[derive(Debug, Clone)]
pub struct ServerDownload {
    pub url: String,
    pub sha1: String,
    pub size: Option<u64>,
}

/// Resolves the official server jar for a manifest entry.
pub async fn vanilla_server_download(entry: &VersionEntry) -> io::Result<ServerDownload> {
    #[derive(Deserialize)]
    struct Dl {
        url: String,
        sha1: String,
        size: Option<u64>,
    }
    #[derive(Deserialize)]
    struct Downloads {
        server: Option<Dl>,
    }
    #[derive(Deserialize)]
    struct VersionJson {
        downloads: Downloads,
    }

    let json: VersionJson = client()
        .get(&entry.url)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| {
            other_err(format!(
                "Failed to fetch version info for {}: {e}",
                entry.id
            ))
        })?
        .json()
        .await
        .map_err(|e| other_err(format!("Invalid version info for {}: {e}", entry.id)))?;
    let server = json.downloads.server.ok_or_else(|| {
        other_err(format!(
            "Minecraft {} has no official server download",
            entry.id
        ))
    })?;
    Ok(ServerDownload {
        url: server.url,
        sha1: server.sha1,
        size: server.size,
    })
}

async fn fetch_manifest() -> io::Result<Manifest> {
    client()
        .get(MANIFEST_URL)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| other_err(format!("request failed: {e}")))?
        .json()
        .await
        .map_err(|e| other_err(format!("invalid manifest: {e}")))
}

fn lookup(manifest: Option<&Manifest>, version: &str) -> Option<VersionEntry> {
    manifest?.versions.iter().find(|v| v.id == version).cloned()
}

pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Manifest {
        serde_json::from_str(
            r#"{"latest":{"release":"1.21.4","snapshot":"25w02a"},"versions":[
                {"id":"25w02a","type":"snapshot","url":"u1","releaseTime":"2025-01-08T00:00:00+00:00","sha1":"a"},
                {"id":"1.21.4","type":"release","url":"u2","releaseTime":"2024-12-03T00:00:00+00:00","sha1":"b"}
            ]}"#,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn classifies_versions_from_cache() {
        let dir = std::env::temp_dir().join(format!("mcv-test-{}", uuid::Uuid::new_v4()));
        let cat = VersionCatalog::new(&dir).await;
        // No list at all: everything is unknown, nothing fails.
        assert_eq!(
            cat.status_cached(Some("1.21.4")).await,
            VersionStatus::Unknown
        );
        assert_eq!(cat.cached_snapshot().await.source, Source::None);

        *cat.loaded.write().await = Some(Loaded {
            manifest: fixture(),
            fetched_at: None,
            live_at: None,
        });
        assert_eq!(
            cat.status_cached(Some("1.21.4")).await,
            VersionStatus::Official
        );
        assert_eq!(
            cat.status_cached(Some(" 1.21.4 ")).await,
            VersionStatus::Official
        );
        assert_eq!(
            cat.status_cached(Some("1.21.4-custom")).await,
            VersionStatus::Unknown
        );
        assert_eq!(
            cat.status_cached(Some("banana")).await,
            VersionStatus::Unknown
        );
        assert_eq!(cat.status_cached(None).await, VersionStatus::Unknown);
        assert_eq!(cat.cached_snapshot().await.source, Source::Cache);
    }

    #[tokio::test]
    async fn loads_disk_cache() {
        let dir = std::env::temp_dir().join(format!("mcv-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("cache")).unwrap();
        let body = serde_json::json!({"fetched_at": null, "manifest": fixture()});
        std::fs::write(dir.join("cache/version_manifest.json"), body.to_string()).unwrap();
        let cat = VersionCatalog::new(&dir).await;
        assert_eq!(
            cat.status_cached(Some("25w02a")).await,
            VersionStatus::Official
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn encodes() {
        assert_eq!(urlencode("1.21.4"), "1.21.4");
        assert_eq!(urlencode("1.21 Pre-Release 1"), "1.21%20Pre-Release%201");
    }
}
