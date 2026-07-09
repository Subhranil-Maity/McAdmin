use axum::{
    Json,
    extract::{Multipart, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use tracing::error;

use crate::AppState;

const MAX_FILE_PREVIEW_SIZE: u64 = 5 * 1024 * 1024;
const TEMP_DIR_NAME: &str = ".tmp";

#[derive(Deserialize)]
pub(crate) struct DirQuery {
    path: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ContentQuery {
    path: String,
}

#[derive(Deserialize)]
pub(crate) struct WriteRequest {
    path: String,
    content: String,
    #[serde(default)]
    force: bool,
}

#[derive(Serialize)]
pub(crate) struct DirListResponse {
    path: String,
    entries: Vec<DirEntryInfo>,
}

#[derive(Serialize)]
struct DirEntryInfo {
    name: String,
    size: u64,
    modified: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Serialize)]
pub(crate) struct FileContentResponse {
    path: String,
    size: u64,
    content: String,
}

#[derive(Serialize)]
pub(crate) struct FileWriteResponse {
    status: String,
    path: String,
}

fn safe_join(base: &Path, request_path: &str) -> Result<PathBuf, StatusCode> {
    let clean = request_path.trim_start_matches('/');
    if clean.is_empty() {
        return Ok(base.to_path_buf());
    }

    for component in Path::new(clean).components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let resolved = base.join(clean);

    let base_str = base.to_string_lossy().to_lowercase();
    let resolved_str = resolved.to_string_lossy().to_lowercase();
    if !resolved_str.starts_with(&base_str) {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(resolved)
}

async fn safe_join_canonical(base: &Path, request_path: &str) -> Result<PathBuf, StatusCode> {
    let resolved = safe_join(base, request_path)?;
    let canonical = fs::canonicalize(&resolved).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            error!("failed to canonicalize path {}: {e}", resolved.display());
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    let base_canonical = fs::canonicalize(base).await.map_err(|e| {
        error!("failed to canonicalize base directory: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let base_str = base_canonical.to_string_lossy().to_lowercase();
    let canonical_str = canonical.to_string_lossy().to_lowercase();
    if !canonical_str.starts_with(&base_str) {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(canonical)
}

fn is_likely_text(data: &[u8]) -> bool {
    if data.starts_with(&[0x50, 0x4B, 0x03, 0x04]) {
        return false;
    }
    if data.iter().take(512).any(|&b| b == 0x00) {
        return false;
    }
    true
}

fn format_timestamp(time: SystemTime) -> String {
    let dt: DateTime<Utc> = time.into();
    dt.to_rfc3339()
}

fn normalize_display_path(base: &Path, full: &Path) -> String {
    let base_str = base.to_string_lossy().to_lowercase();
    let full_str = full.to_string_lossy();
    if full_str.to_lowercase().starts_with(&base_str) {
        let relative = &full_str[base_str.len()..];
        let relative = relative.trim_start_matches('\\').trim_start_matches('/');
        if relative.is_empty() {
            String::from("/")
        } else {
            format!("/{}", relative.replace('\\', "/"))
        }
    } else {
        String::from("/")
    }
}

pub(crate) async fn list_directory(
    State(state): State<AppState>,
    Query(query): Query<DirQuery>,
) -> Result<Json<DirListResponse>, StatusCode> {
    let dir_path = query.path.unwrap_or_else(|| String::from("/"));
    let resolved = safe_join_canonical(&state.server_dir, &dir_path).await?;

    let meta = fs::symlink_metadata(&resolved).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            error!("failed to read metadata for {}: {e}", resolved.display());
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    if !meta.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut read_dir = fs::read_dir(&resolved).await.map_err(|e| {
        error!("failed to read directory {}: {e}", resolved.display());
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut entries = Vec::new();
    while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
        error!("failed to read directory entry: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let entry_meta = fs::symlink_metadata(entry.path()).await.map_err(|e| {
            error!("failed to read entry metadata: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let entry_type = if entry_meta.file_type().is_symlink() {
            "symlink"
        } else if entry_meta.file_type().is_dir() {
            "dir"
        } else {
            "file"
        };

        entries.push(DirEntryInfo {
            name,
            size: entry_meta.len(),
            modified: entry_meta.modified().map(format_timestamp).unwrap_or_default(),
            entry_type: entry_type.to_string(),
        });
    }

    entries.sort_by(|a, b| {
        let a_is_dir = a.entry_type == "dir";
        let b_is_dir = b.entry_type == "dir";
        if a_is_dir != b_is_dir {
            b_is_dir.cmp(&a_is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    let display_path = normalize_display_path(&state.server_dir, &resolved);

    Ok(Json(DirListResponse {
        path: display_path,
        entries,
    }))
}

pub(crate) async fn get_file_content(
    State(state): State<AppState>,
    Query(query): Query<ContentQuery>,
) -> Result<Json<FileContentResponse>, StatusCode> {
    let resolved = safe_join_canonical(&state.server_dir, &query.path).await?;

    let meta = fs::symlink_metadata(&resolved).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            error!("failed to read metadata for {}: {e}", resolved.display());
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    if meta.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    if meta.len() > MAX_FILE_PREVIEW_SIZE {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let data = fs::read(&resolved).await.map_err(|e| {
        error!("failed to read file {}: {e}", resolved.display());
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if !is_likely_text(&data) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let content = String::from_utf8_lossy(&data).to_string();

    let display_path = normalize_display_path(&state.server_dir, &resolved);

    Ok(Json(FileContentResponse {
        path: display_path,
        size: meta.len(),
        content,
    }))
}

pub(crate) async fn write_file(
    State(state): State<AppState>,
    Json(body): Json<WriteRequest>,
) -> Result<Json<FileWriteResponse>, StatusCode> {
    let resolved = safe_join(&state.server_dir, &body.path)?;

    if !body.force && fs::try_exists(&resolved).await.unwrap_or(false) {
        return Err(StatusCode::CONFLICT);
    }

    let display_path = normalize_display_path(&state.server_dir, &resolved);

    write_file_inner(&state.server_dir, &resolved, body.content.as_bytes()).await?;

    Ok(Json(FileWriteResponse {
        status: "ok".into(),
        path: display_path,
    }))
}

pub(crate) async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<FileWriteResponse>, StatusCode> {
    let mut request_path: Option<String> = None;
    let mut file_data: Option<Vec<u8>> = None;
    let mut force = false;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("failed to read multipart field: {e}");
        StatusCode::BAD_REQUEST
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "path" => {
                request_path = Some(field.text().await.map_err(|e| {
                    error!("failed to read path field: {e}");
                    StatusCode::BAD_REQUEST
                })?);
            }
            "file" => {
                let bytes = field.bytes().await.map_err(|e| {
                    error!("failed to read file field: {e}");
                    StatusCode::BAD_REQUEST
                })?;
                file_data = Some(bytes.to_vec());
            }
            "force" => {
                let val = field.text().await.unwrap_or_default();
                force = val == "true" || val == "1";
            }
            _ => {}
        }
    }

    let path = request_path.ok_or_else(|| {
        error!("missing required multipart field: path");
        StatusCode::BAD_REQUEST
    })?;

    let data = file_data.ok_or_else(|| {
        error!("missing required multipart field: file");
        StatusCode::BAD_REQUEST
    })?;

    let resolved = safe_join(&state.server_dir, &path)?;

    if !force && fs::try_exists(&resolved).await.unwrap_or(false) {
        return Err(StatusCode::CONFLICT);
    }

    let display_path = normalize_display_path(&state.server_dir, &resolved);

    write_file_inner(&state.server_dir, &resolved, &data).await?;

    Ok(Json(FileWriteResponse {
        status: "ok".into(),
        path: display_path,
    }))
}

async fn write_file_inner(base: &Path, destination: &Path, data: &[u8]) -> Result<(), StatusCode> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).await.map_err(|e| {
            error!("failed to create parent directories for {}: {e}", destination.display());
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    let temp_dir = base.join(TEMP_DIR_NAME);
    fs::create_dir_all(&temp_dir).await.map_err(|e| {
        error!("failed to create temp directory: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let original_name = destination
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let temp_path = temp_dir.join(format!("{}_{}", ts, original_name));

    fs::write(&temp_path, data).await.map_err(|e| {
        error!("failed to write temp file {}: {e}", temp_path.display());
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Err(e) = fs::rename(&temp_path, destination).await {
        error!(
            "failed to rename {} to {}: {e}",
            temp_path.display(),
            destination.display()
        );

        let _ = fs::remove_file(&temp_path).await;

        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(())
}
