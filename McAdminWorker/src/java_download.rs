//! Downloads and installs official Eclipse Temurin JREs (via the Adoptium API)
//! into `$HOME_DIR/java/temurin-<major>/`.

use futures_util::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

/// Java major versions offered as managed (auto-downloaded) runtimes.
pub const MANAGED_MAJORS: [u32; 4] = [8, 17, 21, 25];
pub const MANAGED_PREFIX: &str = "temurin-";
pub const MANAGED_AUTO_ID: &str = "temurin-auto";
const COMPLETE_MARKER: &str = ".complete";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedSelection {
    Auto,
    Major(u32),
}

/// Parses a managed runtime id (`temurin-auto`, `temurin-21`, ...).
pub fn parse_managed_id(id: &str) -> Option<ManagedSelection> {
    let id = id.trim();
    if id == MANAGED_AUTO_ID {
        return Some(ManagedSelection::Auto);
    }
    let major = id.strip_prefix(MANAGED_PREFIX)?.parse::<u32>().ok()?;
    MANAGED_MAJORS
        .contains(&major)
        .then_some(ManagedSelection::Major(major))
}

/// Java version recommended by Mojang for a given Minecraft version.
pub fn recommended_major(mc_version: Option<&str>) -> u32 {
    let Some(ver) = mc_version.map(str::trim).filter(|v| !v.is_empty()) else {
        return 21;
    };
    let nums: Vec<u32> = ver
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .take(3)
        .filter_map(|s| s.parse().ok())
        .collect();

    match nums.as_slice() {
        // Legacy "1.x.y" versioning
        [1, minor, rest @ ..] => {
            let patch = rest.first().copied().unwrap_or(0);
            match *minor {
                0..=16 => 8,
                17..=19 => 17,
                20 if patch < 5 => 17,
                _ => 21,
            }
        }
        // Year-based versioning (26.1+) requires Java 25
        [year, ..] if *year >= 26 => 25,
        _ => 21,
    }
}

pub fn java_root(home: &Path) -> PathBuf {
    home.join("java")
}

pub fn managed_dir(home: &Path, major: u32) -> PathBuf {
    java_root(home).join(format!("{MANAGED_PREFIX}{major}"))
}

pub fn managed_java_bin(home: &Path, major: u32) -> PathBuf {
    managed_dir(home, major).join("bin").join("java")
}

pub async fn is_installed(home: &Path, major: u32) -> bool {
    tokio::fs::try_exists(managed_dir(home, major).join(COMPLETE_MARKER))
        .await
        .unwrap_or(false)
}

/// Release name (e.g. `jdk-21.0.6+7`) of an installed managed runtime.
pub async fn installed_release(home: &Path, major: u32) -> Option<String> {
    tokio::fs::read_to_string(managed_dir(home, major).join(COMPLETE_MARKER))
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn install_lock(major: u32) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<u32, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .entry(major)
        .or_default()
        .clone()
}

#[derive(Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
    release_name: String,
}

#[derive(Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(Deserialize)]
struct AdoptiumPackage {
    link: String,
    checksum: Option<String>,
    size: Option<u64>,
}

fn adoptium_arch() -> io::Result<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("aarch64"),
        other => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("No official Temurin JRE available for architecture '{other}'"),
        )),
    }
}

fn other_err(msg: impl Into<String>) -> io::Error {
    io::Error::other(msg.into())
}

/// Ensures Temurin JRE `major` is installed, downloading it if needed.
/// Progress lines are reported through `log`. Returns the `java` executable path.
pub async fn ensure_installed(
    home: &Path,
    major: u32,
    log: impl Fn(String) + Send + Sync,
) -> io::Result<PathBuf> {
    let lock = install_lock(major);
    let _guard = lock.lock().await;

    let bin = managed_java_bin(home, major);
    if is_installed(home, major).await {
        return Ok(bin);
    }

    let root = java_root(home);
    tokio::fs::create_dir_all(&root).await?;

    log(format!("[Java] Eclipse Temurin JRE {major} is not installed; fetching release info from Adoptium..."));

    let client = reqwest::Client::builder()
        .user_agent(concat!("McAdminWorker/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| other_err(e.to_string()))?;

    let url = format!(
        "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?os=linux&architecture={}&image_type=jre&vendor=eclipse",
        adoptium_arch()?
    );
    let assets: Vec<AdoptiumAsset> = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| other_err(format!("Adoptium API request failed: {e}")))?
        .json()
        .await
        .map_err(|e| other_err(format!("Invalid Adoptium API response: {e}")))?;
    let asset = assets
        .into_iter()
        .next()
        .ok_or_else(|| other_err(format!("No Temurin JRE {major} release found for this platform")))?;

    let release = asset.release_name;
    let pkg = asset.binary.package;
    let archive_path = root.join(format!(".tmp-{MANAGED_PREFIX}{major}.tar.gz"));
    let staging_dir = root.join(format!(".tmp-{MANAGED_PREFIX}{major}"));

    // Download with progress + checksum
    let resp = client
        .get(&pkg.link)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| other_err(format!("Download failed: {e}")))?;
    let total = pkg.size.or(resp.content_length());
    let mb = |b: u64| b as f64 / 1_048_576.0;

    log(match total {
        Some(t) => format!("[Java] Downloading Temurin JRE {major} ({release}), {:.1} MB...", mb(t)),
        None => format!("[Java] Downloading Temurin JRE {major} ({release})..."),
    });

    let mut file = tokio::fs::File::create(&archive_path).await?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_step: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| other_err(format!("Download interrupted: {e}")))?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        if let Some(t) = total.filter(|t| *t > 0) {
            let pct = downloaded * 100 / t;
            if pct / 5 > last_step {
                last_step = pct / 5;
                log(format!(
                    "[Java] Downloading Temurin JRE {major}: {pct}% ({:.1}/{:.1} MB)",
                    mb(downloaded),
                    mb(t)
                ));
            }
        }
    }
    file.flush().await?;
    drop(file);

    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if let Some(expected) = pkg.checksum.as_deref() {
        if !expected.eq_ignore_ascii_case(&digest) {
            let _ = tokio::fs::remove_file(&archive_path).await;
            return Err(other_err(format!(
                "Checksum mismatch for Temurin JRE {major} (expected {expected}, got {digest})"
            )));
        }
        log("[Java] Checksum verified (sha256).".to_string());
    }

    log(format!("[Java] Extracting Temurin JRE {major}..."));
    let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    {
        let archive_path = archive_path.clone();
        let staging_dir = staging_dir.clone();
        tokio::task::spawn_blocking(move || extract_tar_gz(&archive_path, &staging_dir))
            .await
            .map_err(|e| other_err(e.to_string()))??;
    }
    let _ = tokio::fs::remove_file(&archive_path).await;

    let final_dir = managed_dir(home, major);
    let _ = tokio::fs::remove_dir_all(&final_dir).await;
    tokio::fs::rename(&staging_dir, &final_dir).await?;

    if !tokio::fs::try_exists(&bin).await.unwrap_or(false) {
        return Err(other_err(format!(
            "Extracted Temurin JRE {major} but {} is missing",
            bin.display()
        )));
    }
    tokio::fs::write(final_dir.join(COMPLETE_MARKER), &release).await?;

    log(format!("[Java] Installed Temurin JRE {major} ({release}) at {}", final_dir.display()));
    Ok(bin)
}

/// Extracts a .tar.gz, stripping the top-level directory.
fn extract_tar_gz(archive: &Path, dest: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dest)?;
    let file = std::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.set_preserve_permissions(true);

    for entry in tar.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let stripped: PathBuf = path.components().skip(1).collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }
        if stripped
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(other_err(format!("Unsafe path in archive: {}", path.display())));
        }
        let target = dest.join(&stripped);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry.unpack(&target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommended_versions() {
        assert_eq!(recommended_major(Some("1.12.2")), 8);
        assert_eq!(recommended_major(Some("1.16.5")), 8);
        assert_eq!(recommended_major(Some("1.17.1")), 17);
        assert_eq!(recommended_major(Some("1.20.4")), 17);
        assert_eq!(recommended_major(Some("1.20.5")), 21);
        assert_eq!(recommended_major(Some("1.21.4")), 21);
        assert_eq!(recommended_major(Some("26.1")), 25);
        assert_eq!(recommended_major(None), 21);
        assert_eq!(recommended_major(Some("latest")), 21);
    }

    #[test]
    fn parse_ids() {
        assert_eq!(parse_managed_id("temurin-auto"), Some(ManagedSelection::Auto));
        assert_eq!(parse_managed_id("temurin-21"), Some(ManagedSelection::Major(21)));
        assert_eq!(parse_managed_id("temurin-11"), None);
        assert_eq!(parse_managed_id("java-21"), None);
    }

    /// Hits the network; run with `JAVA_DL_TEST_HOME=/tmp/x cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn downloads_and_runs_temurin() {
        let home = PathBuf::from(std::env::var("JAVA_DL_TEST_HOME").expect("JAVA_DL_TEST_HOME"));
        let bin = ensure_installed(&home, 21, |l| println!("{l}")).await.unwrap();
        assert!(is_installed(&home, 21).await);
        let out = std::process::Command::new(&bin).arg("-version").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stderr).contains("Temurin"));
    }
}
