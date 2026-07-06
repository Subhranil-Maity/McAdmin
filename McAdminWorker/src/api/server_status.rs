use axum::{Json, extract::State};
use serde::Serialize;
use sysinfo::System;

use crate::AppState;

const RECENT_LOG_LINES: usize = 250;

#[derive(Debug, Serialize)]
pub struct ServerStatusResponse {
    pub status: String,
    pub cpu_usage: f32,
    pub ram_allocated_mb: u64,
    pub ram_used_mb: u64,
    pub uptime_seconds: u64,
    pub active_players: u32,
    pub max_players: u32,
    pub recent_logs: Vec<String>,
}

pub(crate) async fn server_status(State(state): State<AppState>) -> Json<ServerStatusResponse> {
    let mut system = state.system.lock().await;
    system.refresh_memory();
    system.refresh_cpu_usage();
    let server_status = state.minecraft.lock().await.state.as_str().to_string();

    Json(ServerStatusResponse {
        status: server_status,
        cpu_usage: system.global_cpu_usage(),
        ram_allocated_mb: system.total_memory() / 1024 / 1024,
        ram_used_mb: system.used_memory() / 1024 / 1024,
        uptime_seconds: System::uptime(),
        active_players: 0,
        max_players: 10,
        recent_logs: state.logs.get_last_n(RECENT_LOG_LINES),
    })
}
