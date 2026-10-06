//! Installs Modrinth modpacks (`.mrpack`, Fabric only) into an instance folder.
//!
//! Format: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::content::{self, META_DIR, is_safe_relative};
use crate::http_download::{self, Hash};
use crate::jobs::JobHandle;
use crate::modrinth::ModrinthClient;

const PACK_STATE_FILE: &str = "modpack.json";
/// Hosts the mrpack spec allows file downloads from.
const ALLOWED_HOSTS: [&str; 4] = [
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "gitlab.com",
];

#[derive(Debug, Clone, Deserialize)]
pub struct MrIndex {
    #[serde(default)]
    pub name: String,
    #[serde(rename = "versionId", default)]
    pub version_id: String,
    #[serde(default)]
    pub files: Vec<MrFile>,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MrFile {
    pub path: String,
    #[serde(default)]
    pub hashes: HashMap<String, String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize", default)]
    pub file_size: Option<u64>,
}

impl MrFile {
    pub fn needed_on_server(&self) -> bool {
        self.env
            .as_ref()
            .and_then(|e| e.get("server"))
            .is_none_or(|s| s != "unsupported")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackState {
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader_version: String,
    pub installed_at: String,
    /// Relative paths written by the pack (removed on reinstall/upgrade).
    #[serde(default)]
    pub files: Vec<String>,
}

pub struct PackResult {
    pub minecraft_version: String,
    pub loader_version: String,
    pub name: String,
    pub version_number: String,
}

impl MrIndex {
    /// Validates loader requirements: (minecraft version, fabric loader version).
    pub fn fabric_requirements(&self) -> Result<(String, String), String> {
        let mc = self
            .dependencies
            .get("minecraft")
            .cloned()
            .ok_or("Modpack does not declare a Minecraft version")?;
        match self.dependencies.get("fabric-loader") {
            Some(loader) => Ok((mc, loader.clone())),
            None => {
                let other: Vec<&str> = self
                    .dependencies
                    .keys()
                    .map(String::as_str)
                    .filter(|k| *k != "minecraft")
                    .collect();
                Err(format!(
                    "Only Fabric modpacks are supported (this pack needs {})",
                    if other.is_empty() {
                        "an unknown loader".to_string()
                    } else {
                        other.join(", ")
                    }
                ))
            }
        }
    }
}

pub fn parse_index(mrpack: &Path) -> Result<MrIndex, String> {
    let file = std::fs::File::open(mrpack).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Invalid .mrpack: {e}"))?;
    let mut entry = zip
        .by_name("modrinth.index.json")
        .map_err(|_| "Invalid .mrpack: missing modrinth.index.json".to_string())?;
    let mut text = String::new();
    entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("Invalid modrinth.index.json: {e}"))
}

/// Extracts `overrides/` then `server-overrides/` into `dest`. Returns written paths.
pub fn extract_overrides(mrpack: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(mrpack).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Invalid .mrpack: {e}"))?;
    let mut written = Vec::new();
    for prefix in ["overrides/", "server-overrides/"] {
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            let Some(rel) = name.strip_prefix(prefix) else {
                continue;
            };
            let rel = rel.trim_end_matches('/');
            if rel.is_empty() {
                continue;
            }
            if !is_safe_relative(rel) || rel.starts_with(META_DIR) {
                return Err(format!("Unsafe path in modpack: {name}"));
            }
            let target = dest.join(rel);
            if entry.is_dir() {
                std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            if !written.iter().any(|w| w == rel) {
                written.push(rel.to_string());
            }
        }
    }
    Ok(written)
}

fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    ALLOWED_HOSTS.contains(&host)
}

pub async fn read_state(dir: &Path) -> Option<PackState> {
    let text = tokio::fs::read_to_string(dir.join(META_DIR).join(PACK_STATE_FILE))
        .await
        .ok()?;
    serde_json::from_str(&text).ok()
}

/// Removes files written by a previously installed pack (world data and files
/// the user added are left alone).
async fn remove_previous(dir: &Path, job: &JobHandle) {
    let Some(prev) = read_state(dir).await else {
        return;
    };
    job.message(format!(
        "Removing files from previous modpack {} {}",
        prev.name, prev.version_number
    ));
    let mut removed = Vec::new();
    for rel in &prev.files {
        if !is_safe_relative(rel) || rel.starts_with(META_DIR) {
            continue;
        }
        if tokio::fs::remove_file(dir.join(rel)).await.is_ok() {
            removed.push(rel.clone());
        }
    }
    let level = content::level_name(dir).await;
    let _ = content::modify_store(dir, |s| {
        s.entries.retain(|e| {
            let rel = match e.kind {
                content::ContentKind::Mod => format!("mods/{}", e.filename),
                content::ContentKind::Datapack => format!("{level}/datapacks/{}", e.filename),
                content::ContentKind::Resourcepack => return true,
            };
            !removed.contains(&rel)
        })
    })
    .await;
}

/// Downloads and installs a Fabric modpack version into `dir`.
pub async fn install(
    dir: &Path,
    modrinth: &ModrinthClient,
    version_id: &str,
    job: &JobHandle,
) -> Result<PackResult, String> {
    let on_wait = |s: u64| job.waiting(s);
    job.message("Fetching modpack info from Modrinth...");
    let version = modrinth
        .version(version_id, &on_wait)
        .await
        .map_err(|e| e.to_string())?;
    if !version.loaders.iter().any(|l| l == "fabric") {
        return Err(format!(
            "Only Fabric modpacks are supported (this version is for {})",
            version.loaders.join(", ")
        ));
    }
    let project_title = modrinth
        .project(&version.project_id)
        .await
        .map(|p| p.title)
        .unwrap_or_else(|_| version.name.clone());
    let file = version
        .files
        .iter()
        .find(|f| f.filename.ends_with(".mrpack") && f.primary)
        .or_else(|| {
            version
                .files
                .iter()
                .find(|f| f.filename.ends_with(".mrpack"))
        })
        .ok_or("This version has no .mrpack file")?;

    let tmp_dir = dir.join(META_DIR).join("tmp");
    let mrpack = tmp_dir.join("pack.mrpack");
    http_download::download_to_file(
        &file.url,
        &mrpack,
        file.hashes.sha512.clone().map(Hash::Sha512),
        file.size,
        &format!("{project_title} {}", version.version_number),
        &|l| job.quiet_message(l),
    )
    .await
    .map_err(|e| e.to_string())?;

    let result = install_from_file(dir, &mrpack, job).await;
    let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
    let (index, files) = result?;
    let (mc, loader) = index.fabric_requirements()?;

    let state = PackState {
        project_id: version.project_id.clone(),
        version_id: version.id.clone(),
        version_number: version.version_number.clone(),
        name: project_title.clone(),
        minecraft_version: mc.clone(),
        loader_version: loader.clone(),
        installed_at: Utc::now().to_rfc3339(),
        files,
    };
    let meta = dir.join(META_DIR);
    tokio::fs::create_dir_all(&meta)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(
        meta.join(PACK_STATE_FILE),
        serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|e| e.to_string())?;

    job.quiet_message("Fetching mod details...");
    content::enrich_modpack_entries(dir, modrinth, job).await;

    Ok(PackResult {
        minecraft_version: mc,
        loader_version: loader,
        name: project_title,
        version_number: version.version_number,
    })
}

/// Installs from a downloaded `.mrpack`. Returns the index and all written paths.
async fn install_from_file(
    dir: &Path,
    mrpack: &Path,
    job: &JobHandle,
) -> Result<(MrIndex, Vec<String>), String> {
    let index = {
        let p = mrpack.to_path_buf();
        tokio::task::spawn_blocking(move || parse_index(&p))
            .await
            .map_err(|e| e.to_string())??
    };
    let (mc, loader) = index.fabric_requirements()?;
    job.message(format!(
        "Installing {} {} (Minecraft {mc}, Fabric loader {loader})",
        index.name, index.version_id
    ));

    let files: Vec<&MrFile> = index
        .files
        .iter()
        .filter(|f| f.needed_on_server())
        .collect();
    for f in &files {
        if !is_safe_relative(&f.path) || f.path.starts_with(META_DIR) {
            return Err(format!("Unsafe path in modpack: {}", f.path));
        }
    }

    remove_previous(dir, job).await;

    job.set_total(files.len() as u64 + 1);
    let mut written: Vec<String> = Vec::new();
    let mut recorded = Vec::new();
    for f in &files {
        let dest: PathBuf = dir.join(&f.path);
        let name = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        job.quiet_message(format!("Downloading {name}"));
        let expected = f
            .hashes
            .get("sha512")
            .cloned()
            .map(Hash::Sha512)
            .or_else(|| f.hashes.get("sha1").cloned().map(Hash::Sha1));
        let mut last_err = format!("No allowed download URL for {}", f.path);
        let mut ok = false;
        for url in f.downloads.iter().filter(|u| host_allowed(u)) {
            match http_download::download_to_file(
                url,
                &dest,
                expected.clone(),
                f.file_size,
                &name,
                &|_| {},
            )
            .await
            {
                Ok(_) => {
                    ok = true;
                    break;
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        if !ok {
            return Err(last_err);
        }
        written.push(f.path.clone());
        recorded.push((
            f.path.clone(),
            f.hashes.get("sha1").cloned(),
            f.hashes.get("sha512").cloned(),
            f.file_size,
        ));
        job.advance();
    }

    job.message("Extracting configuration overrides...");
    // A pack may ship its own server.properties; McAdmin's port/RCON settings must survive it.
    const MANAGED_KEYS: [&str; 4] = ["server-port", "enable-rcon", "rcon.port", "rcon.password"];
    let props_before = content::read_properties(dir).await;
    let mut overrides = {
        let p = mrpack.to_path_buf();
        let d = dir.to_path_buf();
        tokio::task::spawn_blocking(move || extract_overrides(&p, &d))
            .await
            .map_err(|e| e.to_string())??
    };
    if overrides.iter().any(|p| p == "server.properties") {
        let keep: Vec<(&str, String)> = MANAGED_KEYS
            .iter()
            .filter_map(|k| props_before.get(*k).map(|v| (*k, v.clone())))
            .collect();
        content::set_properties(dir, &keep)
            .await
            .map_err(|e| e.to_string())?;
        // Never remove server.properties when the pack is replaced later.
        overrides.retain(|p| p != "server.properties");
    }
    // Overridden mod jars still count as pack content.
    for rel in &overrides {
        if !written.contains(rel) {
            if rel.starts_with("mods/") && rel.ends_with(".jar") {
                if let Ok((sha1, sha512)) = http_download::file_hashes(&dir.join(rel)).await {
                    let size = tokio::fs::metadata(dir.join(rel))
                        .await
                        .ok()
                        .map(|m| m.len());
                    recorded.push((rel.clone(), Some(sha1), Some(sha512), size));
                }
            }
            written.push(rel.clone());
        }
    }
    job.advance();

    content::record_modpack_files(dir, &recorded)
        .await
        .map_err(|e| e.to_string())?;
    Ok((index, written))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_pack(path: &Path, index: &str, extra: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = Default::default();
        zip.start_file("modrinth.index.json", opts).unwrap();
        zip.write_all(index.as_bytes()).unwrap();
        for (name, data) in extra {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    const INDEX: &str = r#"{"formatVersion":1,"game":"minecraft","versionId":"1.0","name":"Test Pack",
        "files":[
          {"path":"mods/a.jar","hashes":{"sha1":"x","sha512":"y"},"env":{"client":"required","server":"required"},
           "downloads":["https://cdn.modrinth.com/data/a.jar"],"fileSize":10},
          {"path":"mods/client-only.jar","hashes":{"sha1":"x"},"env":{"client":"required","server":"unsupported"},
           "downloads":["https://cdn.modrinth.com/data/b.jar"],"fileSize":10},
          {"path":"mods/noenv.jar","hashes":{"sha1":"x"},"downloads":["https://cdn.modrinth.com/data/c.jar"]}
        ],
        "dependencies":{"minecraft":"1.21.1","fabric-loader":"0.16.5"}}"#;

    #[test]
    fn parses_index_and_filters_server_files() {
        let dir = std::env::temp_dir().join(format!("mrpack-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pack = dir.join("p.mrpack");
        make_pack(&pack, INDEX, &[]);
        let idx = parse_index(&pack).unwrap();
        assert_eq!(
            idx.fabric_requirements().unwrap(),
            ("1.21.1".into(), "0.16.5".into())
        );
        let server: Vec<&str> = idx
            .files
            .iter()
            .filter(|f| f.needed_on_server())
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(server, vec!["mods/a.jar", "mods/noenv.jar"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_non_fabric() {
        let idx: MrIndex =
            serde_json::from_str(r#"{"dependencies":{"minecraft":"1.20.1","forge":"47.0"}}"#)
                .unwrap();
        let err = idx.fabric_requirements().unwrap_err();
        assert!(err.contains("forge"), "{err}");
    }

    #[test]
    fn extracts_overrides_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("mrpack-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pack = dir.join("p.mrpack");
        make_pack(
            &pack,
            INDEX,
            &[
                ("overrides/config/a.toml", b"a=1"),
                ("server-overrides/config/a.toml", b"a=2"),
            ],
        );
        let out = dir.join("out");
        let written = extract_overrides(&pack, &out).unwrap();
        assert_eq!(written, vec!["config/a.toml".to_string()]);
        // server-overrides win
        assert_eq!(
            std::fs::read_to_string(out.join("config/a.toml")).unwrap(),
            "a=2"
        );

        let bad = dir.join("bad.mrpack");
        make_pack(&bad, INDEX, &[("overrides/../escape.txt", b"x")]);
        assert!(extract_overrides(&bad, &dir.join("out2")).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn download_hosts() {
        assert!(host_allowed("https://cdn.modrinth.com/data/x.jar"));
        assert!(host_allowed("https://github.com/a/b/releases/x.jar"));
        assert!(!host_allowed("http://cdn.modrinth.com/x.jar"));
        assert!(!host_allowed("https://evil.example/x.jar"));
        assert!(!host_allowed("https://cdn.modrinth.com.evil.example/x.jar"));
    }
}
