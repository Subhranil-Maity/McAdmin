use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaRuntime {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaRuntimeInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_default: bool,
    pub version_detected: Option<String>,
    pub is_valid: bool,
}

#[derive(Debug)]
pub struct JavaManager {
    path: PathBuf,
    runtimes: Mutex<Vec<JavaRuntime>>,
}

impl JavaManager {
    pub async fn load(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();

        let runtimes = if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&path).await?;
            match serde_json::from_str::<Vec<JavaRuntime>>(&content) {
                Ok(list) if !list.is_empty() => list,
                Ok(_) => {
                    info!("java_runtimes.json is empty; scanning system for JVMs...");
                    let detected = Self::scan_system_jvms().await;
                    Self::save_file(&path, &detected).await?;
                    detected
                }
                Err(err) => {
                    warn!("Failed to parse {}: {err}. Re-scanning system JVMs...", path.display());
                    let detected = Self::scan_system_jvms().await;
                    Self::save_file(&path, &detected).await?;
                    detected
                }
            }
        } else {
            info!("java_runtimes.json not found at {}; scanning host system...", path.display());
            let detected = Self::scan_system_jvms().await;
            Self::save_file(&path, &detected).await?;
            detected
        };

        Ok(Self {
            path,
            runtimes: Mutex::new(runtimes),
        })
    }

    async fn save_file(path: &Path, runtimes: &[JavaRuntime]) -> io::Result<()> {
        let json = serde_json::to_string_pretty(runtimes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(path, json).await
    }

    pub async fn reload_from_disk_if_present(&self) {
        if tokio::fs::try_exists(&self.path).await.unwrap_or(false) {
            if let Ok(content) = tokio::fs::read_to_string(&self.path).await {
                if let Ok(list) = serde_json::from_str::<Vec<JavaRuntime>>(&content) {
                    let mut lock = self.runtimes.lock().await;
                    *lock = list;
                }
            }
        }
    }

    pub async fn list_runtimes(&self) -> Vec<JavaRuntimeInfo> {
        self.reload_from_disk_if_present().await;

        let runtimes = {
            let lock = self.runtimes.lock().await;
            lock.clone()
        };

        let mut results = Vec::with_capacity(runtimes.len());
        for r in runtimes {
            let (is_valid, version_detected) = Self::probe_java(&r.path).await;
            results.push(JavaRuntimeInfo {
                id: r.id,
                name: r.name,
                path: r.path,
                is_default: r.is_default,
                version_detected,
                is_valid,
            });
        }
        results
    }

    pub async fn resolve_executable(&self, runtime_id_or_path: Option<&str>) -> String {
        self.reload_from_disk_if_present().await;
        let lock = self.runtimes.lock().await;

        if let Some(target) = runtime_id_or_path {
            let target_trimmed = target.trim();
            if !target_trimmed.is_empty() {
                // Match by id
                if let Some(matched) = lock.iter().find(|r| r.id == target_trimmed) {
                    return matched.path.clone();
                }
                // Match by exact path
                if let Some(matched) = lock.iter().find(|r| r.path == target_trimmed) {
                    return matched.path.clone();
                }
                // If it looks like a direct executable path on disk
                if target_trimmed.starts_with('/') || target_trimmed.starts_with("./") {
                    return target_trimmed.to_string();
                }
            }
        }

        // Fallback 1: runtime marked is_default
        if let Some(default_runtime) = lock.iter().find(|r| r.is_default) {
            return default_runtime.path.clone();
        }

        // Fallback 2: first runtime in the list
        if let Some(first) = lock.first() {
            return first.path.clone();
        }

        // Fallback 3: system PATH "java"
        "java".to_string()
    }

    pub async fn scan_and_merge(&self) -> io::Result<Vec<JavaRuntimeInfo>> {
        self.reload_from_disk_if_present().await;

        let scanned = Self::scan_system_jvms().await;
        let mut lock = self.runtimes.lock().await;

        let mut existing_paths = HashSet::new();
        for r in lock.iter() {
            existing_paths.insert(r.path.clone());
        }

        let mut has_default = lock.iter().any(|r| r.is_default);

        for mut sc in scanned {
            if !existing_paths.contains(&sc.path) {
                existing_paths.insert(sc.path.clone());
                if !has_default && sc.is_default {
                    has_default = true;
                } else if has_default {
                    sc.is_default = false;
                }
                lock.push(sc);
            }
        }

        if !lock.iter().any(|r| r.is_default) {
            if let Some(first) = lock.first_mut() {
                first.is_default = true;
            }
        }

        Self::save_file(&self.path, &lock).await?;
        drop(lock);

        Ok(self.list_runtimes().await)
    }

    pub async fn add_or_update(&self, runtime: JavaRuntime) -> io::Result<()> {
        let mut lock = self.runtimes.lock().await;

        if runtime.is_default {
            for r in lock.iter_mut() {
                r.is_default = false;
            }
        }

        if let Some(existing) = lock.iter_mut().find(|r| r.id == runtime.id) {
            *existing = runtime;
        } else {
            lock.push(runtime);
        }

        if !lock.iter().any(|r| r.is_default) {
            if let Some(first) = lock.first_mut() {
                first.is_default = true;
            }
        }

        Self::save_file(&self.path, &lock).await
    }

    pub async fn delete(&self, id: &str) -> io::Result<()> {
        let mut lock = self.runtimes.lock().await;
        let prev_len = lock.len();
        lock.retain(|r| r.id != id);

        if lock.len() < prev_len && !lock.iter().any(|r| r.is_default) {
            if let Some(first) = lock.first_mut() {
                first.is_default = true;
            }
        }

        Self::save_file(&self.path, &lock).await
    }

    pub async fn probe_java(path: &str) -> (bool, Option<String>) {
        let res = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::process::Command::new(path).arg("-version").output(),
        )
        .await;

        match res {
            Ok(Ok(output)) => {
                let combined = format!(
                    "{}\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                let ver = extract_java_version(&combined);
                (true, ver)
            }
            _ => (false, None),
        }
    }

    pub async fn scan_system_jvms() -> Vec<JavaRuntime> {
        let mut candidate_paths: Vec<PathBuf> = Vec::new();

        let search_dirs = [
            "/usr/lib/jvm",
            "/usr/java",
            "/opt/java",
            "/opt/jdk",
            "/usr/local/java",
        ];

        for dir_str in &search_dirs {
            let dir = Path::new(dir_str);
            if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    let java_bin = path.join("bin").join("java");
                    if tokio::fs::try_exists(&java_bin).await.unwrap_or(false) {
                        candidate_paths.push(java_bin);
                    }
                }
            }
        }

        // Also check if system PATH "java" is present
        if let Ok(which_out) = tokio::process::Command::new("which")
            .arg("java")
            .output()
            .await
        {
            if which_out.status.success() {
                let p = String::from_utf8_lossy(&which_out.stdout).trim().to_string();
                if !p.is_empty() {
                    candidate_paths.push(PathBuf::from(p));
                }
            }
        }

        // Canonicalize and deduplicate
        let mut seen_canonical = HashSet::new();
        let mut runtimes = Vec::new();

        for candidate in candidate_paths {
            let canonical = tokio::fs::canonicalize(&candidate)
                .await
                .unwrap_or_else(|_| candidate.clone());

            let canonical_str = canonical.to_string_lossy().to_string();
            if seen_canonical.contains(&canonical_str) {
                continue;
            }
            seen_canonical.insert(canonical_str.clone());

            let (valid, ver_opt) = Self::probe_java(&canonical_str).await;
            if valid {
                let (id, name) = generate_runtime_metadata(&canonical_str, ver_opt.as_deref());
                runtimes.push(JavaRuntime {
                    id,
                    name,
                    path: canonical_str,
                    is_default: false,
                });
            }
        }

        // Ensure default fallback if no JVMs found
        if runtimes.is_empty() {
            runtimes.push(JavaRuntime {
                id: "default".to_string(),
                name: "System Default (java)".to_string(),
                path: "java".to_string(),
                is_default: true,
            });
        } else {
            // Pick preferred default: prefer Java 21, then Java 17, otherwise first found
            let default_idx = runtimes
                .iter()
                .position(|r| r.id.contains("21"))
                .or_else(|| runtimes.iter().position(|r| r.id.contains("17")))
                .unwrap_or(0);
            runtimes[default_idx].is_default = true;
        }

        runtimes
    }
}

fn extract_java_version(output: &str) -> Option<String> {
    for line in output.lines() {
        if let Some(idx) = line.find("version \"") {
            let rest = &line[idx + 9..];
            if let Some(end) = rest.find('"') {
                return Some(rest[..end].to_string());
            }
        }
    }
    output.lines().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string())
}

fn generate_runtime_metadata(path: &str, version: Option<&str>) -> (String, String) {
    if let Some(ver) = version {
        let major = if ver.starts_with("1.") {
            ver.split('.').nth(1).unwrap_or("8")
        } else {
            ver.split(&['.', '-'][..]).next().unwrap_or("unknown")
        };

        let id = format!("java-{}", major);
        let name = format!("Java {} ({})", major, ver);
        (id, name)
    } else {
        let file_stem = Path::new(path)
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "custom".to_string());
        (format!("java-{}", file_stem), format!("Java ({file_stem})"))
    }
}
