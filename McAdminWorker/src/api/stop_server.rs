use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;
use tracing::{error, info};

use crate::{AppState, MinecraftServerState};

#[derive(Debug, Serialize)]
pub(crate) struct StopServerResponse {
    status: &'static str,
    process_id: Option<u32>,
}

pub(crate) async fn stop_server(
    State(state): State<AppState>,
) -> Result<Json<StopServerResponse>, StatusCode> {
    info!("stop server requested");

    let mut child = {
        let mut minecraft = state.minecraft.lock().await;
        if minecraft.state == MinecraftServerState::Offline {
            error!("stop server requested while server is offline");
            return Err(StatusCode::CONFLICT);
        }

        minecraft.state = MinecraftServerState::Offline;
        minecraft.process_id = None;
        minecraft.child.take()
    };

    if let Some(child) = child.as_mut() {
        child
            .kill()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let _ = child.wait().await;
    }

    Ok(Json(StopServerResponse {
        status: MinecraftServerState::Offline.as_str(),
        process_id: None,
    }))
}
