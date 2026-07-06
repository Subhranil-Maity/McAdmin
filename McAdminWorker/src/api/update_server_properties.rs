use axum::{Json, extract::State, http::StatusCode};
use std::io;
use std::path::Path;
use tracing::error;

use crate::AppState;

use super::{SERVER_PROPERTIES_FILE, ServerProperties};

pub(crate) async fn update_server_properties(
    State(state): State<AppState>,
    Json(properties): Json<ServerProperties>,
) -> Result<Json<ServerProperties>, StatusCode> {
    if properties.keys().any(|key| key.trim().is_empty()) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let properties_path = state.server_dir.join(SERVER_PROPERTIES_FILE);
    write_server_properties(&properties_path, &properties)
        .await
        .map_err(|error| {
            error!(
                "failed to write server properties to {}: {error}",
                properties_path.display()
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(properties))
}

async fn write_server_properties(path: &Path, properties: &ServerProperties) -> io::Result<()> {
    let mut file_contents = String::new();

    for (key, value) in properties {
        file_contents.push_str(key);
        file_contents.push('=');
        file_contents.push_str(value);
        file_contents.push('\n');
    }

    tokio::fs::write(path, file_contents).await
}
