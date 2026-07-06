use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;
use std::sync::Arc;
use tracing::{error, info};

use crate::{
    AppState, MinecraftServerState, monitor_minecraft_server, resolve_jar_path,
    start_minecraft_server,
};

#[derive(Debug, Serialize)]
pub(crate) struct StartServerResponse {
    status: &'static str,
    ram_gb: u32,
    process_id: Option<u32>,
}

pub(crate) async fn start_server(
    State(state): State<AppState>,
) -> Result<Json<StartServerResponse>, StatusCode> {
    info!("start server requested");

    if !state.server_dir.exists() {
        error!("server directory missing: {}", state.server_dir.display());
        return Err(StatusCode::NOT_FOUND);
    }

    let ram_gb = state.config.get_server_ram().await;
    let jar_path = Arc::new(resolve_jar_path(state.config.get_jar_path().await));
    if !jar_path.exists() {
        error!("jar file missing: {}", jar_path.display());
        return Err(StatusCode::NOT_FOUND);
    }

    info!(
        "start server requested: jar_path={}, server_dir={}, ram_gb={}",
        jar_path.display(),
        state.server_dir.display(),
        ram_gb
    );

    let process_id = {
        let mut minecraft = state.minecraft.lock().await;
        if minecraft.state != MinecraftServerState::Offline {
            return Err(StatusCode::CONFLICT);
        }

        minecraft.state = MinecraftServerState::Starting;
        minecraft.process_id = None;
        minecraft.child = None;

        if let Err(error) = start_minecraft_server(
            &jar_path,
            &state.server_dir,
            ram_gb,
            state.logs.clone(),
            &mut minecraft,
        )
        .await
        {
            error!("Minecraft server failed: {error}");
            minecraft.state = MinecraftServerState::Offline;
            minecraft.process_id = None;
            minecraft.child = None;
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }

        minecraft.process_id
    };

    tokio::spawn(monitor_minecraft_server(state.minecraft.clone()));

    Ok(Json(StartServerResponse {
        status: MinecraftServerState::Online.as_str(),
        ram_gb,
        process_id,
    }))
}
