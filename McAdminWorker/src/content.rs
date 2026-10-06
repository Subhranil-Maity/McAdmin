//! Installed content (mods, datapacks, resource pack) for an instance, plus the
//! local Modrinth metadata cache in `<instance>/.mcadmin/content.json`.
//!
//! Listing never touches the network, so installed content (names, versions,
//! icons, update info) stays visible while Modrinth is unreachable.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use tracing::warn;

use crate::http_download::{self, Hash, file_hashes};
use crate::instance_config::ServerType;
use crate::jobs::JobHandle;
use crate::modrinth::{ModrinthClient, ModrinthError, Project, Version};

pub const META_DIR: &str = ".mcadmin";
const STORE_FILE: &str = "content.json";
const ICON_DIR: &str = "icons";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Mod,
    Datapack,
    Resourcepack,
}

impl ContentKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "mod" | "mods" => Some(Self::Mod),
            "datapack" | "datapacks" => Some(Self::Datapack),
            "resourcepack" | "resourcepacks" | "resource_pack" => Some(Self::Resourcepack),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetaSource {
    /// Installed from Modrinth through McAdmin.
    Modrinth,
    /// Matched to Modrinth by file hash.
    Identified,
    /// Installed as part of a Modrinth modpack.
    Modpack,
    /// Not on Modrinth; name/version read from the file itself.
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentEntry {
    pub kind: ContentKind,
    pub filename: String,
    pub source: MetaSource,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    /// Locally cached icon file name in `.mcadmin/icons/`.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub version_number: Option<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha512: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    /// Project ids of required dependencies.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Download URL (resource packs are served to clients from this URL).
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub installed_at: Option<String>,
    #[serde(default)]
    pub identified_at: Option<String>,
    #[serde(default)]
    pub latest_version_id: Option<String>,
    #[serde(default)]
    pub latest_version_number: Option<String>,
}

impl ContentEntry {
    fn blank(kind: ContentKind, filename: &str, source: MetaSource) -> Self {
        Self {
            kind,
            filename: filename.to_string(),
            source,
            project_id: None,
            slug: None,
            title: None,
            description: None,
            icon_url: None,
            icon: None,
            version_id: None,
            version_number: None,
            game_versions: Vec::new(),
            loaders: Vec::new(),
            sha1: None,
            sha512: None,
            size: None,
            dependencies: Vec::new(),
            url: None,
            installed_at: None,
            identified_at: None,
            latest_version_id: None,
            latest_version_number: None,
        }
    }

    fn apply_version(&mut self, version: &Version) {
        self.project_id = Some(version.project_id.clone());
        self.version_id = Some(version.id.clone());
        self.version_number = Some(version.version_number.clone());
        self.game_versions = version.game_versions.clone();
        self.loaders = version.loaders.clone();
        self.dependencies = required_dependency_projects(version);
    }

    fn apply_project(&mut self, project: &Project) {
        self.project_id = Some(project.id.clone());
        self.slug = Some(project.slug.clone()).filter(|s| !s.is_empty());
        self.title = Some(project.title.clone()).filter(|s| !s.is_empty());
        self.description = Some(project.description.clone()).filter(|s| !s.is_empty());
        self.icon_url = project.icon_url.clone().filter(|s| !s.is_empty());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContentStore {
    #[serde(default)]
    pub entries: Vec<ContentEntry>,
    #[serde(default)]
    pub last_identified: Option<String>,
    #[serde(default)]
    pub last_update_check: Option<String>,
}

impl ContentStore {
    fn find(&self, kind: ContentKind, filename: &str) -> Option<&ContentEntry> {
        self.entries
            .iter()
            .find(|e| e.kind == kind && e.filename == filename)
    }

    pub fn upsert(&mut self, entry: ContentEntry) {
        self.entries
            .retain(|e| !(e.kind == entry.kind && e.filename == entry.filename));
        self.entries.push(entry);
    }

    fn remove(&mut self, kind: ContentKind, filename: &str) {
        self.entries
            .retain(|e| !(e.kind == kind && e.filename == filename));
    }
}

/// Per-instance lock for `content.json` writes.
fn store_lock(dir: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .entry(dir.to_path_buf())
        .or_default()
        .clone()
}

pub async fn load_store(dir: &Path) -> ContentStore {
    let path = dir.join(META_DIR).join(STORE_FILE);
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            warn!("Ignoring unreadable {}: {e}", path.display());
            ContentStore::default()
        }),
        Err(_) => ContentStore::default(),
    }
}

pub async fn save_store(dir: &Path, store: &ContentStore) -> io::Result<()> {
    let meta = dir.join(META_DIR);
    tokio::fs::create_dir_all(&meta).await?;
    let path = meta.join(STORE_FILE);
    let tmp = meta.join(format!("{STORE_FILE}.tmp"));
    tokio::fs::write(&tmp, serde_json::to_vec_pretty(store)?).await?;
    tokio::fs::rename(&tmp, &path).await
}

/// Loads, modifies and saves the store under the instance lock.
pub async fn modify_store<R>(dir: &Path, f: impl FnOnce(&mut ContentStore) -> R) -> io::Result<R> {
    let lock = store_lock(dir);
    let _guard = lock.lock().await;
    let mut store = load_store(dir).await;
    let r = f(&mut store);
    save_store(dir, &store).await?;
    Ok(r)
}

// ---------- server.properties helpers ----------

pub async fn read_properties(dir: &Path) -> HashMap<String, String> {
    let text = tokio::fs::read_to_string(dir.join("server.properties"))
        .await
        .unwrap_or_default();
    let mut map = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    map
}

/// Sets keys in `server.properties`, preserving other lines and their order.
pub async fn set_properties(dir: &Path, pairs: &[(&str, String)]) -> io::Result<()> {
    let path = dir.join("server.properties");
    let text = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let mut remaining: Vec<&(&str, String)> = pairs.iter().collect();
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        let key = line
            .split_once('=')
            .map(|(k, _)| k.trim())
            .filter(|_| !line.trim_start().starts_with('#'));
        if let Some(pos) = key.and_then(|k| remaining.iter().position(|(pk, _)| *pk == k)) {
            let (k, v) = remaining.remove(pos);
            lines.push(format!("{k}={}", escape_property(v)));
        } else {
            lines.push(line.to_string());
        }
    }
    for (k, v) in remaining {
        lines.push(format!("{k}={}", escape_property(v)));
    }
    tokio::fs::write(&path, lines.join("\n") + "\n").await
}

/// Java properties treat `:` and `=` in values literally after the first `=`, but
/// backslashes are escapes; URLs never need more than this.
fn escape_property(v: &str) -> String {
    v.replace('\\', "\\\\").replace('\n', "")
}

/// Unescapes the `\:` / `\=` sequences Minecraft writes into URLs.
fn unescape_property(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(n) = chars.next() {
                out.push(n);
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub async fn level_name(dir: &Path) -> String {
    read_properties(dir)
        .await
        .remove("level-name")
        .map(|s| s.trim().to_string())
        .filter(|s| is_safe_relative(s))
        .unwrap_or_else(|| "world".to_string())
}

// ---------- paths ----------

/// A single plain file name (no separators, no `..`).
pub fn is_safe_file_name(name: &str) -> bool {
    let mut comps = Path::new(name).components();
    matches!(comps.next(), Some(Component::Normal(_)))
        && comps.next().is_none()
        && !name.contains('\\')
}

/// A relative path made only of normal components.
pub fn is_safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

pub async fn content_dir(dir: &Path, kind: ContentKind) -> Option<PathBuf> {
    match kind {
        ContentKind::Mod => Some(dir.join("mods")),
        ContentKind::Datapack => Some(dir.join(level_name(dir).await).join("datapacks")),
        ContentKind::Resourcepack => None,
    }
}

// ---------- listing ----------

#[derive(Debug, Serialize)]
pub struct ContentItem {
    pub kind: ContentKind,
    pub filename: String,
    pub size: Option<u64>,
    pub is_dir: bool,
    /// `modrinth`, `identified`, `modpack`, `manual` or `unidentified`.
    pub status: String,
    pub project_id: Option<String>,
    pub slug: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub has_icon: bool,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub game_versions: Vec<String>,
    pub latest_version_id: Option<String>,
    pub latest_version_number: Option<String>,
    pub update_available: bool,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ContentListing {
    pub items: Vec<ContentItem>,
    pub level_name: String,
    pub last_identified: Option<String>,
    pub last_update_check: Option<String>,
    pub modpack: Option<serde_json::Value>,
}

fn item_from(
    kind: ContentKind,
    filename: String,
    size: Option<u64>,
    is_dir: bool,
    meta: Option<&ContentEntry>,
) -> ContentItem {
    // A cached entry whose recorded size no longer matches the file is stale.
    let meta = meta.filter(|m| is_dir || m.size.is_none() || m.size == size);
    let status = match meta.map(|m| m.source) {
        Some(MetaSource::Modrinth) => "modrinth",
        Some(MetaSource::Identified) => "identified",
        Some(MetaSource::Modpack) => "modpack",
        Some(MetaSource::Manual) => "manual",
        None => "unidentified",
    };
    let update_available =
        meta.is_some_and(|m| m.latest_version_id.is_some() && m.latest_version_id != m.version_id);
    ContentItem {
        kind,
        filename,
        size,
        is_dir,
        status: status.to_string(),
        project_id: meta.and_then(|m| m.project_id.clone()),
        slug: meta.and_then(|m| m.slug.clone()),
        title: meta.and_then(|m| m.title.clone()),
        description: meta.and_then(|m| m.description.clone()),
        has_icon: meta.is_some_and(|m| m.icon.is_some()),
        version_id: meta.and_then(|m| m.version_id.clone()),
        version_number: meta.and_then(|m| m.version_number.clone()),
        game_versions: meta.map(|m| m.game_versions.clone()).unwrap_or_default(),
        latest_version_id: meta.and_then(|m| m.latest_version_id.clone()),
        latest_version_number: meta.and_then(|m| m.latest_version_number.clone()),
        update_available,
        url: meta.and_then(|m| m.url.clone()),
    }
}

async fn scan_dir(
    path: &Path,
    exts: &[&str],
    include_dirs: bool,
) -> Vec<(String, Option<u64>, bool)> {
    let mut out = Vec::new();
    let Ok(mut rd) = tokio::fs::read_dir(path).await else {
        return out;
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(md) = entry.metadata().await else {
            continue;
        };
        if md.is_dir() {
            if include_dirs {
                out.push((name, None, true));
            }
        } else if exts.iter().any(|e| name.to_ascii_lowercase().ends_with(e)) {
            out.push((name, Some(md.len()), false));
        }
    }
    out.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    out
}

pub async fn list(dir: &Path) -> ContentListing {
    let store = load_store(dir).await;
    let level = level_name(dir).await;
    let mut items = Vec::new();

    for (name, size, is_dir) in scan_dir(&dir.join("mods"), &[".jar"], false).await {
        let meta = store.find(ContentKind::Mod, &name);
        items.push(item_from(ContentKind::Mod, name, size, is_dir, meta));
    }
    for (name, size, is_dir) in scan_dir(&dir.join(&level).join("datapacks"), &[".zip"], true).await
    {
        let meta = store.find(ContentKind::Datapack, &name);
        items.push(item_from(ContentKind::Datapack, name, size, is_dir, meta));
    }

    let props = read_properties(dir).await;
    if let Some(url) = props
        .get("resource-pack")
        .map(|u| unescape_property(u))
        .filter(|u| !u.trim().is_empty())
    {
        let meta = store.entries.iter().find(|e| {
            e.kind == ContentKind::Resourcepack && e.url.as_deref() == Some(url.as_str())
        });
        let name = meta
            .map(|m| m.filename.clone())
            .unwrap_or_else(|| url.rsplit('/').next().unwrap_or(&url).to_string());
        let mut item = item_from(
            ContentKind::Resourcepack,
            name,
            meta.and_then(|m| m.size),
            false,
            meta,
        );
        item.url = Some(url);
        if meta.is_none() {
            item.status = "manual".to_string();
        }
        items.push(item);
    }

    let modpack = tokio::fs::read_to_string(dir.join(META_DIR).join("modpack.json"))
        .await
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .map(|mut v| {
            if let Some(obj) = v.as_object_mut() {
                obj.remove("files");
            }
            v
        });

    ContentListing {
        items,
        level_name: level,
        last_identified: store.last_identified,
        last_update_check: store.last_update_check,
        modpack,
    }
}

pub async fn delete(dir: &Path, kind: ContentKind, filename: &str) -> io::Result<()> {
    match kind {
        ContentKind::Resourcepack => {
            set_properties(
                dir,
                &[
                    ("resource-pack", String::new()),
                    ("resource-pack-sha1", String::new()),
                ],
            )
            .await?;
            modify_store(dir, |s| {
                s.entries.retain(|e| e.kind != ContentKind::Resourcepack)
            })
            .await?;
            return Ok(());
        }
        _ => {
            if !is_safe_file_name(filename) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid file name",
                ));
            }
            let base = content_dir(dir, kind).await.expect("file-based kind");
            let path = base.join(filename);
            let md = tokio::fs::metadata(&path).await?;
            if md.is_dir() {
                tokio::fs::remove_dir_all(&path).await?;
            } else {
                tokio::fs::remove_file(&path).await?;
            }
        }
    }
    modify_store(dir, |s| s.remove(kind, filename)).await?;
    Ok(())
}

pub fn icon_path(dir: &Path, file: &str) -> Option<PathBuf> {
    is_safe_file_name(file).then(|| dir.join(META_DIR).join(ICON_DIR).join(file))
}

/// Finds the cached icon file for a project.
pub async fn find_icon(dir: &Path, project_id: &str) -> Option<PathBuf> {
    let store = load_store(dir).await;
    let file = store
        .entries
        .iter()
        .find(|e| e.project_id.as_deref() == Some(project_id) && e.icon.is_some())?
        .icon
        .clone()?;
    icon_path(dir, &file)
}

/// Downloads project icons not yet cached locally. Failures are ignored.
async fn cache_icons(dir: &Path, projects: &[Project]) -> HashMap<String, String> {
    let icon_dir = dir.join(META_DIR).join(ICON_DIR);
    let _ = tokio::fs::create_dir_all(&icon_dir).await;
    let mut out = HashMap::new();
    for p in projects {
        let Some(url) = p.icon_url.as_deref().filter(|u| !u.is_empty()) else {
            continue;
        };
        let ext = url
            .rsplit('/')
            .next()
            .and_then(|f| f.split('?').next())
            .and_then(|f| f.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()))
            .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg"))
            .unwrap_or_else(|| "png".to_string());
        let file = format!("{}.{ext}", p.id);
        if !is_safe_file_name(&file) {
            continue;
        }
        let path = icon_dir.join(&file);
        if tokio::fs::try_exists(&path).await.unwrap_or(false)
            || http_download::download_to_file(url, &path, None, None, "icon", &|_| {})
                .await
                .is_ok()
        {
            out.insert(p.id.clone(), file);
        }
    }
    out
}

fn required_dependency_projects(version: &Version) -> Vec<String> {
    version
        .dependencies
        .iter()
        .filter(|d| d.dependency_type == "required")
        .filter_map(|d| d.project_id.clone())
        .collect()
}

fn modrinth_err(e: ModrinthError) -> String {
    e.to_string()
}

// ---------- install ----------

pub struct InstallCtx<'a> {
    pub dir: &'a Path,
    pub server_type: ServerType,
    pub minecraft_version: Option<&'a str>,
    pub modrinth: &'a ModrinthClient,
    pub job: &'a JobHandle,
}

/// Installs a Modrinth version (and, for mods, its required dependencies).
pub async fn install(
    ctx: &InstallCtx<'_>,
    version_id: &str,
    kind: ContentKind,
) -> Result<serde_json::Value, String> {
    let job = ctx.job;
    let on_wait = |s: u64| job.waiting(s);
    job.quiet_message("Fetching version info from Modrinth...");
    let root = ctx
        .modrinth
        .version(version_id, &on_wait)
        .await
        .map_err(modrinth_err)?;

    match kind {
        ContentKind::Mod => {
            if ctx.server_type != ServerType::Fabric {
                return Err("Mods can only be installed on Fabric servers".to_string());
            }
            if !root.loaders.iter().any(|l| l == "fabric") {
                return Err(format!(
                    "This version is for {}, not Fabric",
                    root.loaders.join(", ")
                ));
            }
        }
        ContentKind::Datapack => {
            if !root.loaders.iter().any(|l| l == "datapack") {
                return Err("This version is not a datapack".to_string());
            }
        }
        ContentKind::Resourcepack => {}
    }

    // Resolve the full set of versions to install.
    let mut to_install: Vec<Version> = vec![root.clone()];
    if kind == ContentKind::Mod {
        let store = load_store(ctx.dir).await;
        let installed_projects: HashSet<String> = store
            .entries
            .iter()
            .filter(|e| e.kind == ContentKind::Mod)
            .filter_map(|e| e.project_id.clone())
            .collect();
        let mut seen: HashSet<String> = HashSet::from([root.project_id.clone()]);
        let mut queue: Vec<Version> = vec![root.clone()];
        let game: Vec<&str> = ctx.minecraft_version.into_iter().collect();

        while let Some(v) = queue.pop() {
            for dep in v
                .dependencies
                .iter()
                .filter(|d| d.dependency_type == "required")
            {
                if let Some(pid) = &dep.project_id {
                    if seen.contains(pid) || installed_projects.contains(pid) {
                        continue;
                    }
                }
                job.quiet_message("Resolving required dependencies...");
                let dep_version = match (&dep.version_id, &dep.project_id) {
                    (Some(vid), _) => ctx
                        .modrinth
                        .version(vid, &on_wait)
                        .await
                        .map_err(modrinth_err)?,
                    (None, Some(pid)) => {
                        let versions = ctx
                            .modrinth
                            .project_versions(pid, &["fabric"], &game, &on_wait)
                            .await
                            .map_err(modrinth_err)?;
                        let name = ctx
                            .modrinth
                            .project(pid)
                            .await
                            .map(|p| p.title)
                            .unwrap_or_else(|_| pid.clone());
                        versions.into_iter().next().ok_or_else(|| {
                            format!(
                                "Required dependency \"{name}\" has no Fabric version for Minecraft {}",
                                ctx.minecraft_version.unwrap_or("?")
                            )
                        })?
                    }
                    (None, None) => continue,
                };
                if seen.insert(dep_version.project_id.clone())
                    && !installed_projects.contains(&dep_version.project_id)
                {
                    queue.push(dep_version.clone());
                    to_install.push(dep_version);
                }
            }
        }
    }

    // Project metadata for titles and icons (one batched request).
    let project_ids: Vec<String> = to_install.iter().map(|v| v.project_id.clone()).collect();
    job.quiet_message("Fetching project details...");
    let projects = ctx
        .modrinth
        .projects(&project_ids, &on_wait)
        .await
        .unwrap_or_default();
    let icons = cache_icons(ctx.dir, &projects).await;
    let project_map: HashMap<&str, &Project> =
        projects.iter().map(|p| (p.id.as_str(), p)).collect();

    job.set_total(to_install.len() as u64);
    let mut installed = Vec::new();

    for version in &to_install {
        let file = version
            .primary_file()
            .ok_or_else(|| format!("Version {} has no files", version.version_number))?;
        if !is_safe_file_name(&file.filename) {
            return Err(format!("Refusing unsafe file name {:?}", file.filename));
        }
        let title = project_map
            .get(version.project_id.as_str())
            .map(|p| p.title.clone())
            .unwrap_or_else(|| file.filename.clone());

        let mut entry = ContentEntry::blank(kind, &file.filename, MetaSource::Modrinth);
        entry.apply_version(version);
        if let Some(p) = project_map.get(version.project_id.as_str()) {
            entry.apply_project(p);
        }
        entry.icon = icons.get(&version.project_id).cloned();
        entry.sha1 = file.hashes.sha1.clone();
        entry.sha512 = file.hashes.sha512.clone();
        entry.size = file.size;
        entry.url = Some(file.url.clone());
        entry.installed_at = Some(Utc::now().to_rfc3339());

        match kind {
            ContentKind::Resourcepack => {
                job.message(format!("Setting server resource pack to {title}"));
                let sha1 = file.hashes.sha1.clone().unwrap_or_default();
                set_properties(
                    ctx.dir,
                    &[
                        ("resource-pack", file.url.clone()),
                        ("resource-pack-sha1", sha1),
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
                modify_store(ctx.dir, |s| {
                    s.entries.retain(|e| e.kind != ContentKind::Resourcepack);
                    s.upsert(entry);
                })
                .await
                .map_err(|e| e.to_string())?;
            }
            _ => {
                let base = content_dir(ctx.dir, kind).await.expect("file-based kind");
                let dest = base.join(&file.filename);
                job.message(format!("Downloading {title} {}", version.version_number));
                let expected = file
                    .hashes
                    .sha512
                    .clone()
                    .map(Hash::Sha512)
                    .or_else(|| file.hashes.sha1.clone().map(Hash::Sha1));
                http_download::download_to_file(
                    &file.url,
                    &dest,
                    expected,
                    file.size,
                    &file.filename,
                    &|l| job.quiet_message(l),
                )
                .await
                .map_err(|e| e.to_string())?;

                // Replace an older file of the same project.
                let old_files = modify_store(ctx.dir, |s| {
                    let old: Vec<String> = s
                        .entries
                        .iter()
                        .filter(|e| {
                            e.kind == kind
                                && e.project_id.as_deref() == Some(version.project_id.as_str())
                                && e.filename != file.filename
                        })
                        .map(|e| e.filename.clone())
                        .collect();
                    for f in &old {
                        s.remove(kind, f);
                    }
                    s.upsert(entry);
                    old
                })
                .await
                .map_err(|e| e.to_string())?;
                for old in old_files {
                    if is_safe_file_name(&old) {
                        let _ = tokio::fs::remove_file(base.join(&old)).await;
                        job.message(format!("Removed previous version {old}"));
                    }
                }
            }
        }
        installed.push(serde_json::json!({
            "title": title,
            "version_number": version.version_number,
            "filename": file.filename,
        }));
        job.advance();
    }

    Ok(serde_json::json!({ "installed": installed }))
}

// ---------- identify ----------

/// Reads `fabric.mod.json` from a mod jar: (name, version).
fn read_fabric_mod_json(path: &Path) -> Option<(String, String)> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let mut entry = zip.by_name("fabric.mod.json").ok()?;
    let mut text = String::new();
    std::io::Read::read_to_string(&mut entry, &mut text).ok()?;
    // Some mods ship JSON with raw newlines inside strings; be lenient.
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c == '\n' || c == '\r' || c == '\t' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let v: serde_json::Value = serde_json::from_str(&cleaned).ok()?;
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .or_else(|| v.get("id").and_then(|n| n.as_str()))?
        .to_string();
    let version = v
        .get("version")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    Some((name, version))
}

pub struct IdentifyCtx<'a> {
    pub dir: &'a Path,
    pub minecraft_version: Option<&'a str>,
    pub server_type: ServerType,
    pub modrinth: &'a ModrinthClient,
    pub job: &'a JobHandle,
}

/// Matches mod jars and datapack zips to Modrinth by sha1, caches the metadata,
/// and records the latest compatible version of each for update badges.
pub async fn identify(ctx: &IdentifyCtx<'_>, force: bool) -> Result<serde_json::Value, String> {
    let job = ctx.job;
    let on_wait = |s: u64| job.waiting(s);
    let store = load_store(ctx.dir).await;

    let mut files: Vec<(ContentKind, String, PathBuf, u64)> = Vec::new();
    for (name, size, is_dir) in scan_dir(&ctx.dir.join("mods"), &[".jar"], false).await {
        if !is_dir {
            files.push((
                ContentKind::Mod,
                name.clone(),
                ctx.dir.join("mods").join(&name),
                size.unwrap_or(0),
            ));
        }
    }
    let dp_dir = content_dir(ctx.dir, ContentKind::Datapack).await.unwrap();
    for (name, size, is_dir) in scan_dir(&dp_dir, &[".zip"], false).await {
        if !is_dir {
            files.push((
                ContentKind::Datapack,
                name.clone(),
                dp_dir.join(&name),
                size.unwrap_or(0),
            ));
        }
    }

    // Hash files that are new, changed, or all of them when forced.
    job.set_total(files.len() as u64 + 2);
    job.message(format!("Identifying {} file(s)...", files.len()));
    let mut hashed: Vec<(ContentKind, String, PathBuf, u64, String, String)> = Vec::new();
    for (kind, name, path, size) in &files {
        let cached = store.find(*kind, name);
        let up_to_date = cached.is_some_and(|c| c.size == Some(*size) && c.sha1.is_some());
        let (sha1, sha512) = if up_to_date && !force {
            let c = cached.unwrap();
            (
                c.sha1.clone().unwrap(),
                c.sha512.clone().unwrap_or_default(),
            )
        } else {
            job.quiet_message(format!("Hashing {name}"));
            match file_hashes(path).await {
                Ok(h) => h,
                Err(e) => {
                    warn!("Failed to hash {}: {e}", path.display());
                    job.advance();
                    continue;
                }
            }
        };
        hashed.push((*kind, name.clone(), path.clone(), *size, sha1, sha512));
        job.advance();
    }

    // One batched lookup for every file (500 hashes per request).
    let all_hashes: Vec<String> = hashed.iter().map(|h| h.4.clone()).collect();

    job.quiet_message("Looking up files on Modrinth...");
    let matches = if all_hashes.is_empty() {
        HashMap::new()
    } else {
        ctx.modrinth
            .versions_by_hashes(&all_hashes, "sha1", &on_wait)
            .await
            .map_err(modrinth_err)?
    };
    job.advance();

    let mut project_ids: Vec<String> = matches.values().map(|v| v.project_id.clone()).collect();
    project_ids.sort();
    project_ids.dedup();
    let projects = if project_ids.is_empty() {
        Vec::new()
    } else {
        ctx.modrinth
            .projects(&project_ids, &on_wait)
            .await
            .map_err(modrinth_err)?
    };
    let icons = cache_icons(ctx.dir, &projects).await;
    let project_map: HashMap<&str, &Project> =
        projects.iter().map(|p| (p.id.as_str(), p)).collect();

    // Latest compatible versions (for update badges), mods only on Fabric.
    let mut latest: HashMap<String, Version> = HashMap::new();
    if let Some(mc) = ctx.minecraft_version {
        let mod_hashes: Vec<String> = hashed
            .iter()
            .filter(|h| h.0 == ContentKind::Mod)
            .map(|h| h.4.clone())
            .collect();
        if ctx.server_type == ServerType::Fabric && !mod_hashes.is_empty() {
            job.quiet_message("Checking for updates...");
            latest.extend(
                ctx.modrinth
                    .latest_by_hashes(&mod_hashes, "sha1", &["fabric"], &[mc], &on_wait)
                    .await
                    .unwrap_or_default(),
            );
        }
        let dp_hashes: Vec<String> = hashed
            .iter()
            .filter(|h| h.0 == ContentKind::Datapack)
            .map(|h| h.4.clone())
            .collect();
        if !dp_hashes.is_empty() {
            latest.extend(
                ctx.modrinth
                    .latest_by_hashes(&dp_hashes, "sha1", &["datapack"], &[mc], &on_wait)
                    .await
                    .unwrap_or_default(),
            );
        }
    }
    job.advance();

    let now = Utc::now().to_rfc3339();
    let mut identified = 0usize;
    let mut manual = 0usize;
    let mut new_entries = Vec::new();
    for (kind, name, path, size, sha1, sha512) in &hashed {
        let previous = store
            .find(*kind, name)
            .filter(|c| c.size == Some(*size))
            .cloned();
        let mut entry = match (matches.get(sha1), previous) {
            (Some(version), prev) => {
                let mut e = prev
                    .filter(|p| p.source != MetaSource::Manual)
                    .unwrap_or_else(|| ContentEntry::blank(*kind, name, MetaSource::Identified));
                e.apply_version(version);
                if let Some(p) = project_map.get(version.project_id.as_str()) {
                    e.apply_project(p);
                }
                if let Some(icon) = icons.get(&version.project_id) {
                    e.icon = Some(icon.clone());
                }
                identified += 1;
                e
            }
            (None, Some(prev)) if prev.source != MetaSource::Manual && !force => {
                identified += 1;
                prev
            }
            (None, _) => {
                let mut e = ContentEntry::blank(*kind, name, MetaSource::Manual);
                if *kind == ContentKind::Mod {
                    let p = path.clone();
                    if let Ok(Some((title, ver))) =
                        tokio::task::spawn_blocking(move || read_fabric_mod_json(&p)).await
                    {
                        e.title = Some(title);
                        e.version_number = Some(ver).filter(|v| !v.is_empty());
                    }
                }
                manual += 1;
                e
            }
        };
        entry.sha1 = Some(sha1.clone());
        entry.sha512 = Some(sha512.clone()).filter(|s| !s.is_empty());
        entry.size = Some(*size);
        entry.identified_at = Some(now.clone());
        if let Some(l) = latest.get(sha1) {
            entry.latest_version_id = Some(l.id.clone());
            entry.latest_version_number = Some(l.version_number.clone());
        }
        new_entries.push(entry);
    }

    let on_disk: HashSet<(ContentKind, String)> =
        files.iter().map(|f| (f.0, f.1.clone())).collect();
    let checked_updates = ctx.minecraft_version.is_some();
    modify_store(ctx.dir, |s| {
        // Drop entries for files that no longer exist.
        s.entries.retain(|e| {
            e.kind == ContentKind::Resourcepack || on_disk.contains(&(e.kind, e.filename.clone()))
        });
        for e in new_entries {
            s.upsert(e);
        }
        s.last_identified = Some(now.clone());
        if checked_updates {
            s.last_update_check = Some(now.clone());
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "total": hashed.len(),
        "identified": identified,
        "manual": manual,
    }))
}

/// Records modpack-installed files in the store (hashes are known from the index).
pub async fn record_modpack_files(
    dir: &Path,
    files: &[(String, Option<String>, Option<String>, Option<u64>)],
) -> io::Result<()> {
    let level = level_name(dir).await;
    let now = Utc::now().to_rfc3339();
    modify_store(dir, |s| {
        for (rel, sha1, sha512, size) in files {
            let (kind, name) = if let Some(name) = rel.strip_prefix("mods/") {
                (ContentKind::Mod, name)
            } else if let Some(name) = rel.strip_prefix(&format!("{level}/datapacks/")) {
                (ContentKind::Datapack, name)
            } else {
                continue;
            };
            if name.contains('/') {
                continue;
            }
            let mut e = ContentEntry::blank(kind, name, MetaSource::Modpack);
            e.sha1 = sha1.clone();
            e.sha512 = sha512.clone();
            e.size = *size;
            e.installed_at = Some(now.clone());
            s.upsert(e);
        }
    })
    .await
}

/// Fills in Modrinth metadata for modpack entries (best effort).
pub async fn enrich_modpack_entries(dir: &Path, modrinth: &ModrinthClient, job: &JobHandle) {
    let on_wait = |s: u64| job.waiting(s);
    let store = load_store(dir).await;
    let hashes: Vec<String> = store
        .entries
        .iter()
        .filter(|e| e.source == MetaSource::Modpack && e.project_id.is_none())
        .filter_map(|e| e.sha1.clone())
        .collect();
    if hashes.is_empty() {
        return;
    }
    let Ok(matches) = modrinth.versions_by_hashes(&hashes, "sha1", &on_wait).await else {
        return;
    };
    let mut ids: Vec<String> = matches.values().map(|v| v.project_id.clone()).collect();
    ids.sort();
    ids.dedup();
    let projects = modrinth.projects(&ids, &on_wait).await.unwrap_or_default();
    let icons = cache_icons(dir, &projects).await;
    let pmap: HashMap<&str, &Project> = projects.iter().map(|p| (p.id.as_str(), p)).collect();
    let now = Utc::now().to_rfc3339();
    let _ = modify_store(dir, |s| {
        for e in s
            .entries
            .iter_mut()
            .filter(|e| e.source == MetaSource::Modpack)
        {
            let Some(v) = e.sha1.as_ref().and_then(|h| matches.get(h)) else {
                continue;
            };
            e.apply_version(v);
            if let Some(p) = pmap.get(v.project_id.as_str()) {
                e.apply_project(p);
            }
            e.icon = icons.get(&v.project_id).cloned();
            e.identified_at = Some(now.clone());
        }
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names() {
        assert!(is_safe_file_name("sodium-0.6.jar"));
        assert!(!is_safe_file_name("../x.jar"));
        assert!(!is_safe_file_name("mods/x.jar"));
        assert!(!is_safe_file_name(""));
        assert!(!is_safe_file_name("a\\b.jar"));
        assert!(is_safe_relative("mods/x.jar"));
        assert!(!is_safe_relative("/etc/passwd"));
        assert!(!is_safe_relative("config/../../x"));
    }

    #[tokio::test]
    async fn properties_roundtrip_preserves_lines() {
        let dir = std::env::temp_dir().join(format!("content-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        tokio::fs::write(
            dir.join("server.properties"),
            "#comment\nmotd=Hi\nresource-pack=\nlevel-name=myworld\n",
        )
        .await
        .unwrap();
        set_properties(
            &dir,
            &[
                ("resource-pack", "https://cdn.modrinth.com/x.zip".into()),
                ("resource-pack-sha1", "abc".into()),
            ],
        )
        .await
        .unwrap();
        let text = tokio::fs::read_to_string(dir.join("server.properties"))
            .await
            .unwrap();
        assert!(
            text.starts_with("#comment\nmotd=Hi\nresource-pack=https://cdn.modrinth.com/x.zip\n")
        );
        assert!(text.contains("resource-pack-sha1=abc"));
        assert_eq!(level_name(&dir).await, "myworld");
        assert_eq!(unescape_property("https\\://a/b"), "https://a/b");

        // Listing reads the resource pack and works without any network.
        let listing = list(&dir).await;
        assert_eq!(listing.items.len(), 1);
        assert_eq!(listing.items[0].kind, ContentKind::Resourcepack);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn listing_uses_cached_metadata_offline() {
        let dir = std::env::temp_dir().join(format!("content-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(dir.join("mods")).await.unwrap();
        tokio::fs::write(dir.join("mods/a.jar"), b"1234")
            .await
            .unwrap();
        tokio::fs::write(dir.join("mods/b.jar"), b"12")
            .await
            .unwrap();
        let mut e = ContentEntry::blank(ContentKind::Mod, "a.jar", MetaSource::Identified);
        e.title = Some("Mod A".into());
        e.size = Some(4);
        e.version_id = Some("v1".into());
        e.latest_version_id = Some("v2".into());
        modify_store(&dir, |s| s.upsert(e)).await.unwrap();

        let listing = list(&dir).await;
        let a = listing
            .items
            .iter()
            .find(|i| i.filename == "a.jar")
            .unwrap();
        assert_eq!(a.title.as_deref(), Some("Mod A"));
        assert_eq!(a.status, "identified");
        assert!(a.update_available);
        let b = listing
            .items
            .iter()
            .find(|i| i.filename == "b.jar")
            .unwrap();
        assert_eq!(b.status, "unidentified");

        // A changed file invalidates its cached metadata.
        tokio::fs::write(dir.join("mods/a.jar"), b"123456")
            .await
            .unwrap();
        let listing = list(&dir).await;
        let a = listing
            .items
            .iter()
            .find(|i| i.filename == "a.jar")
            .unwrap();
        assert_eq!(a.status, "unidentified");
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
