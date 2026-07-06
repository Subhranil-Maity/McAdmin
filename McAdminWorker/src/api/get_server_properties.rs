use axum::{Json, extract::State, http::StatusCode};
use std::io;
use tracing::error;

use crate::AppState;

use super::{SERVER_PROPERTIES_FILE, ServerProperties};

pub(crate) async fn get_server_properties(
    State(state): State<AppState>,
) -> Result<Json<ServerProperties>, StatusCode> {
    let properties_path = state.server_dir.join(SERVER_PROPERTIES_FILE);
    let file_contents = tokio::fs::read_to_string(&properties_path)
        .await
        .map_err(|error| {
            error!(
                "failed to read server properties from {}: {error}",
                properties_path.display()
            );
            if error.kind() == io::ErrorKind::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;

    Ok(Json(parse_server_properties(&file_contents)))
}

fn parse_server_properties(file_contents: &str) -> ServerProperties {
    file_contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }

            let (key, value) = line.split_once('=')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}
