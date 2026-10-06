//! Modrinth API v2 client with a shared rate limiter.
//!
//! Modrinth allows 300 requests/minute per IP and reports the budget through
//! `X-Ratelimit-Limit`, `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` (seconds
//! until the window resets). All requests from the worker go through one
//! `ModrinthClient`, which waits for the window to reset when the budget is
//! exhausted and retries on HTTP 429, reporting every wait through `on_wait`.

use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tracing::warn;

use crate::http_download::client;

pub const DEFAULT_BASE_URL: &str = "https://api.modrinth.com/v2";
const DEFAULT_LIMIT: u32 = 300;
const WINDOW: Duration = Duration::from_secs(60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_429_RETRIES: u32 = 3;
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const CACHE_MAX_ENTRIES: usize = 500;

#[derive(Debug)]
pub enum ModrinthError {
    /// Network failure, timeout or 5xx: Modrinth can't be reached right now.
    Unreachable(String),
    NotFound,
    /// Other non-success responses.
    Api(u16, String),
}

impl std::fmt::Display for ModrinthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreachable(e) => write!(f, "Modrinth is unreachable: {e}"),
            Self::NotFound => write!(f, "Not found on Modrinth"),
            Self::Api(code, msg) => write!(f, "Modrinth returned HTTP {code}: {msg}"),
        }
    }
}

pub type Result<T> = std::result::Result<T, ModrinthError>;

/// Called with the number of seconds the client is about to wait.
pub type OnWait<'a> = &'a (dyn Fn(u64) + Send + Sync);

pub fn no_wait_report(_: u64) {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hashes {
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha512: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionFile {
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub size: Option<u64>,
    pub hashes: Hashes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version_number: String,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub version_type: String,
    #[serde(default)]
    pub date_published: String,
    #[serde(default)]
    pub files: Vec<VersionFile>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
}

impl Version {
    /// The primary file, or the first one if none is flagged primary.
    pub fn primary_file(&self) -> Option<&VersionFile> {
        self.files.iter().find(|f| f.primary).or(self.files.first())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub project_type: String,
    #[serde(default)]
    pub server_side: Option<String>,
    #[serde(default)]
    pub client_side: Option<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct SearchParams {
    pub query: String,
    pub project_type: String,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub offset: u32,
    pub limit: u32,
    pub index: Option<String>,
}

struct RateState {
    limit: u32,
    remaining: u32,
    reset_at: Instant,
}

pub struct ModrinthClient {
    base: String,
    rate: Mutex<RateState>,
    cache: Mutex<HashMap<String, (Instant, serde_json::Value)>>,
}

impl ModrinthClient {
    pub fn new(base: Option<String>) -> Self {
        let base = base
            .map(|b| b.trim().trim_end_matches('/').to_string())
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        Self {
            base,
            rate: Mutex::new(RateState {
                limit: DEFAULT_LIMIT,
                remaining: DEFAULT_LIMIT,
                reset_at: Instant::now() + WINDOW,
            }),
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Takes one request from the budget, waiting for the window to reset if needed.
    async fn acquire(&self, on_wait: OnWait<'_>) {
        loop {
            let wait = {
                let mut rate = self.rate.lock().await;
                let now = Instant::now();
                if now >= rate.reset_at {
                    rate.remaining = rate.limit;
                    rate.reset_at = now + WINDOW;
                }
                if rate.remaining > 0 {
                    rate.remaining -= 1;
                    return;
                }
                rate.reset_at - now
            };
            wait_reporting(wait, on_wait).await;
        }
    }

    async fn sync_rate(&self, headers: &reqwest::header::HeaderMap, status: StatusCode) {
        let num = |name: &str| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
        };
        let mut rate = self.rate.lock().await;
        if let Some(limit) = num("x-ratelimit-limit") {
            rate.limit = limit.clamp(1, 10_000) as u32;
        }
        if let Some(remaining) = num("x-ratelimit-remaining") {
            rate.remaining = rate.remaining.min(remaining as u32);
        }
        if let Some(reset) = num("x-ratelimit-reset") {
            rate.reset_at = Instant::now() + Duration::from_secs(reset.min(600));
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            rate.remaining = 0;
            if num("x-ratelimit-reset").is_none() {
                rate.reset_at = Instant::now() + Duration::from_secs(10);
            }
        }
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&serde_json::Value>,
        on_wait: OnWait<'_>,
    ) -> Result<serde_json::Value> {
        let url = format!("{}{}", self.base, path);
        let mut attempts = 0;
        loop {
            self.acquire(on_wait).await;
            let mut req = client()
                .request(method.clone(), &url)
                .timeout(REQUEST_TIMEOUT)
                .query(query);
            if let Some(body) = body {
                req = req.json(body);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| ModrinthError::Unreachable(e.to_string()))?;
            let status = resp.status();
            self.sync_rate(resp.headers(), status).await;

            if status == StatusCode::TOO_MANY_REQUESTS {
                attempts += 1;
                if attempts > MAX_429_RETRIES {
                    return Err(ModrinthError::Api(429, "rate limited".to_string()));
                }
                warn!("Modrinth rate limit hit (429); waiting before retry {attempts}");
                continue; // acquire() waits for the reset
            }
            if status == StatusCode::NOT_FOUND {
                return Err(ModrinthError::NotFound);
            }
            if status.is_server_error() {
                return Err(ModrinthError::Unreachable(format!(
                    "HTTP {}",
                    status.as_u16()
                )));
            }
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                return Err(ModrinthError::Api(
                    status.as_u16(),
                    text.chars().take(300).collect(),
                ));
            }
            return resp
                .json()
                .await
                .map_err(|e| ModrinthError::Unreachable(format!("invalid response: {e}")));
        }
    }

    async fn get_cached(
        &self,
        path: &str,
        query: &[(&str, String)],
        on_wait: OnWait<'_>,
    ) -> Result<serde_json::Value> {
        let key = format!("{path}?{query:?}");
        {
            let cache = self.cache.lock().await;
            if let Some((at, value)) = cache.get(&key) {
                if at.elapsed() < CACHE_TTL {
                    return Ok(value.clone());
                }
            }
        }
        let value = self
            .request(Method::GET, path, query, None, on_wait)
            .await?;
        let mut cache = self.cache.lock().await;
        if cache.len() >= CACHE_MAX_ENTRIES {
            cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            if cache.len() >= CACHE_MAX_ENTRIES {
                cache.clear();
            }
        }
        cache.insert(key, (Instant::now(), value.clone()));
        Ok(value)
    }

    pub async fn search(&self, p: &SearchParams) -> Result<serde_json::Value> {
        let facets = build_facets(
            &p.project_type,
            p.game_version.as_deref(),
            p.loader.as_deref(),
        );
        let mut query = vec![
            ("facets", facets),
            ("offset", p.offset.to_string()),
            ("limit", p.limit.clamp(1, 100).to_string()),
        ];
        if !p.query.trim().is_empty() {
            query.push(("query", p.query.trim().to_string()));
        }
        if let Some(index) = p.index.as_deref().filter(|s| !s.is_empty()) {
            query.push(("index", index.to_string()));
        }
        self.get_cached("/search", &query, &no_wait_report).await
    }

    pub async fn project(&self, id: &str) -> Result<Project> {
        let v = self
            .get_cached(&format!("/project/{}", seg(id)), &[], &no_wait_report)
            .await?;
        parse(v)
    }

    pub async fn projects(&self, ids: &[String], on_wait: OnWait<'_>) -> Result<Vec<Project>> {
        let mut out = Vec::new();
        for chunk in ids.chunks(100) {
            let v = self
                .request(
                    Method::GET,
                    "/projects",
                    &[("ids", json_list(chunk))],
                    None,
                    on_wait,
                )
                .await?;
            out.extend(parse::<Vec<Project>>(v)?);
        }
        Ok(out)
    }

    pub async fn project_versions(
        &self,
        id: &str,
        loaders: &[&str],
        game_versions: &[&str],
        on_wait: OnWait<'_>,
    ) -> Result<Vec<Version>> {
        let mut query = Vec::new();
        if !loaders.is_empty() {
            query.push(("loaders", serde_json::to_string(loaders).unwrap()));
        }
        if !game_versions.is_empty() {
            query.push((
                "game_versions",
                serde_json::to_string(game_versions).unwrap(),
            ));
        }
        let v = self
            .get_cached(&format!("/project/{}/version", seg(id)), &query, on_wait)
            .await?;
        parse(v)
    }

    pub async fn version(&self, id: &str, on_wait: OnWait<'_>) -> Result<Version> {
        let v = self
            .get_cached(&format!("/version/{}", seg(id)), &[], on_wait)
            .await?;
        parse(v)
    }

    /// Looks up versions by file hash (`POST /version_files`). Returns hash -> version.
    pub async fn versions_by_hashes(
        &self,
        hashes: &[String],
        algorithm: &str,
        on_wait: OnWait<'_>,
    ) -> Result<HashMap<String, Version>> {
        let mut out = HashMap::new();
        for chunk in hashes.chunks(500) {
            let body = serde_json::json!({ "hashes": chunk, "algorithm": algorithm });
            let v = self
                .request(Method::POST, "/version_files", &[], Some(&body), on_wait)
                .await?;
            out.extend(parse::<HashMap<String, Version>>(v)?);
        }
        Ok(out)
    }

    /// Latest compatible version for each file hash (`POST /version_files/update`).
    pub async fn latest_by_hashes(
        &self,
        hashes: &[String],
        algorithm: &str,
        loaders: &[&str],
        game_versions: &[&str],
        on_wait: OnWait<'_>,
    ) -> Result<HashMap<String, Version>> {
        let mut out = HashMap::new();
        for chunk in hashes.chunks(500) {
            let body = serde_json::json!({
                "hashes": chunk,
                "algorithm": algorithm,
                "loaders": loaders,
                "game_versions": game_versions,
            });
            let v = self
                .request(
                    Method::POST,
                    "/version_files/update",
                    &[],
                    Some(&body),
                    on_wait,
                )
                .await?;
            out.extend(parse::<HashMap<String, Version>>(v)?);
        }
        Ok(out)
    }
}

async fn wait_reporting(wait: Duration, on_wait: OnWait<'_>) {
    let mut left = wait.as_secs_f64().ceil() as u64;
    if left == 0 {
        tokio::time::sleep(wait).await;
        return;
    }
    while left > 0 {
        on_wait(left);
        tokio::time::sleep(Duration::from_secs(1)).await;
        left -= 1;
    }
}

fn parse<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T> {
    serde_json::from_value(v)
        .map_err(|e| ModrinthError::Unreachable(format!("unexpected response: {e}")))
}

fn json_list(ids: &[String]) -> String {
    serde_json::to_string(ids).unwrap()
}

/// Encodes a single path segment.
fn seg(s: &str) -> String {
    crate::mc_versions::urlencode(s)
}

/// Builds the Modrinth search `facets` parameter.
pub fn build_facets(
    project_type: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
) -> String {
    let mut facets: Vec<Vec<String>> = Vec::new();
    match project_type {
        // Datapacks are mods with the "datapack" loader on Modrinth.
        "datapack" => {
            facets.push(vec![
                "project_type:mod".into(),
                "project_type:datapack".into(),
            ]);
            facets.push(vec!["categories:datapack".into()]);
        }
        "mod" => {
            facets.push(vec!["project_type:mod".into()]);
            facets.push(vec![format!("categories:{}", loader.unwrap_or("fabric"))]);
            facets.push(vec![
                "server_side:required".into(),
                "server_side:optional".into(),
            ]);
        }
        "modpack" => {
            facets.push(vec!["project_type:modpack".into()]);
            facets.push(vec![format!("categories:{}", loader.unwrap_or("fabric"))]);
            facets.push(vec![
                "server_side:required".into(),
                "server_side:optional".into(),
            ]);
        }
        "resourcepack" => facets.push(vec!["project_type:resourcepack".into()]),
        other => facets.push(vec![format!("project_type:{other}")]),
    }
    if let Some(gv) = game_version.map(str::trim).filter(|s| !s.is_empty()) {
        facets.push(vec![format!("versions:{gv}")]);
    }
    serde_json::to_string(&facets).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn facets() {
        let f: Vec<Vec<String>> =
            serde_json::from_str(&build_facets("mod", Some("1.21.4"), None)).unwrap();
        assert!(f.contains(&vec!["project_type:mod".to_string()]));
        assert!(f.contains(&vec!["categories:fabric".to_string()]));
        assert!(f.contains(&vec!["versions:1.21.4".to_string()]));

        let f: Vec<Vec<String>> =
            serde_json::from_str(&build_facets("datapack", None, None)).unwrap();
        assert!(f.contains(&vec!["categories:datapack".to_string()]));
        assert!(
            !f.iter()
                .any(|g| g.iter().any(|s| s.starts_with("versions:")))
        );
    }

    /// Minimal one-shot HTTP server returning canned responses in order.
    async fn mock_server(responses: Vec<String>) -> (String, Arc<AtomicU64>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let hits = Arc::new(AtomicU64::new(0));
        let hits2 = hits.clone();
        tokio::spawn(async move {
            for resp in responses {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                hits2.fetch_add(1, Ordering::SeqCst);
                sock.write_all(resp.as_bytes()).await.unwrap();
                let _ = sock.shutdown().await;
            }
        });
        (format!("http://{addr}"), hits)
    }

    fn http(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        )
    }

    #[tokio::test]
    async fn waits_and_retries_on_429() {
        let version = r#"{"id":"v1","project_id":"p1","files":[]}"#;
        let (base, hits) = mock_server(vec![
            http(
                "429 Too Many Requests",
                "X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1\r\n",
                "{}",
            ),
            http(
                "200 OK",
                "X-Ratelimit-Remaining: 299\r\nX-Ratelimit-Reset: 60\r\n",
                version,
            ),
        ])
        .await;
        let client = ModrinthClient::new(Some(base));
        let waits = Arc::new(AtomicU64::new(0));
        let w = waits.clone();
        let report = move |_s: u64| {
            w.fetch_add(1, Ordering::SeqCst);
        };
        let v = client.version("v1", &report).await.unwrap();
        assert_eq!(v.id, "v1");
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        assert!(
            waits.load(Ordering::SeqCst) >= 1,
            "wait callback should fire"
        );
    }

    #[tokio::test]
    async fn waits_when_budget_exhausted() {
        let version = r#"{"id":"v2","project_id":"p1","files":[]}"#;
        let (base, _) = mock_server(vec![
            http(
                "200 OK",
                "X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1\r\n",
                version,
            ),
            http("200 OK", "X-Ratelimit-Remaining: 299\r\n", version),
        ])
        .await;
        let client = ModrinthClient::new(Some(base));
        let waits = Arc::new(AtomicU64::new(0));
        let w = waits.clone();
        let report = move |_s: u64| {
            w.fetch_add(1, Ordering::SeqCst);
        };
        client.version("a", &report).await.unwrap();
        assert_eq!(waits.load(Ordering::SeqCst), 0);
        client.version("b", &report).await.unwrap();
        assert!(waits.load(Ordering::SeqCst) >= 1);
    }

    #[tokio::test]
    async fn unreachable_is_reported() {
        let client = ModrinthClient::new(Some("http://127.0.0.1:1".to_string()));
        match client.version("x", &no_wait_report).await {
            Err(ModrinthError::Unreachable(_)) => {}
            other => panic!("expected Unreachable, got {other:?}"),
        }
    }
}
