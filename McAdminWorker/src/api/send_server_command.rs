use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub(crate) struct ServerCommandRequest {
    command: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ServerCommandResponse {
    status: &'static str,
    command: String,
    response: String,
}

pub(crate) async fn send_server_command(
    State(state): State<AppState>,
    Json(payload): Json<ServerCommandRequest>,
) -> Result<Json<ServerCommandResponse>, StatusCode> {
    let command = payload.command.trim();
    if command.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let response = state.rcon.execute(command).await.map_err(|error| {
        error!("RCON command failed: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    Ok(Json(ServerCommandResponse {
        status: "ok",
        command: command.to_string(),
        response,
    }))
}
