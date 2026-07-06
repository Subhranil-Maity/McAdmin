use serde::Serialize;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

const SERVER_RAM_KEY: &str = "SERVER_RAM";
const JAR_PATH_KEY: &str = "JAR_PATH";
const DEFAULT_JAR_PATH: &str = "./server.jar";

#[derive(Debug)]
pub struct ConfigManager {
    values: Mutex<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
}

impl ConfigManager {
    pub async fn load(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let mut values = read_config_file(&path).await?;

        let mut config_changed = false;

        if !values.contains_key(SERVER_RAM_KEY) {
            values.insert(SERVER_RAM_KEY.to_string(), "1".to_string());
            config_changed = true;
        }

        if !values.contains_key(JAR_PATH_KEY) {
            values.insert(JAR_PATH_KEY.to_string(), DEFAULT_JAR_PATH.to_string());
            config_changed = true;
        }

        if config_changed {
            write_config_file(&path, &values).await?;
        }

        Ok(Self {
            values: Mutex::new(values),
        })
    }

    pub async fn list(&self) -> Vec<ConfigEntry> {
        let values = self.values.lock().await;
        let mut entries = values
            .iter()
            .map(|(key, value)| ConfigEntry {
                key: key.clone(),
                value: value.clone(),
            })
            .collect::<Vec<_>>();

        entries.sort_by(|left, right| left.key.cmp(&right.key));
        entries
    }

    pub async fn get(&self, key: &str) -> Option<String> {
        self.values.lock().await.get(key).cloned()
    }

    pub async fn get_server_ram(&self) -> u32 {
        self.values
            .lock()
            .await
            .get(SERVER_RAM_KEY)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(1)
    }

    pub async fn get_jar_path(&self) -> PathBuf {
        self.values
            .lock()
            .await
            .get(JAR_PATH_KEY)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_JAR_PATH))
    }
}

async fn read_config_file(path: &Path) -> io::Result<HashMap<String, String>> {
    if !tokio::fs::try_exists(path).await? {
        write_config_file(path, &HashMap::new()).await?;
    }

    let file_contents = tokio::fs::read_to_string(path).await?;

    serde_json::from_str(&file_contents).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("failed to parse config JSON: {error}"),
        )
    })
}

async fn write_config_file(path: &Path, values: &HashMap<String, String>) -> io::Result<()> {
    if let Some(parent_dir) = path.parent() {
        tokio::fs::create_dir_all(parent_dir).await?;
    }

    let file_contents = serde_json::to_string_pretty(values).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("failed to serialize config JSON: {error}"),
        )
    })?;

    tokio::fs::write(path, file_contents).await
}
