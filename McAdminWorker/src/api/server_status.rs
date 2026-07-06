use axum::{Json, extract::State};
use serde::Serialize;
use sysinfo::System;

use crate::{AppState, MinecraftServerState};

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

    let (status_str, active_players, max_players) = {
        let runtime = state.minecraft.lock().await;
        let s = runtime.state.as_str().to_string();
        if runtime.state == MinecraftServerState::Online {
            match state.rcon.execute("list").await {
                Ok(resp) => {
                    let (a, m) = parse_counts(&resp);
                    (s, a, m)
                }
                Err(_) => (s, 0, 0),
            }
        } else {
            (s, 0, 0)
        }
    };

    Json(ServerStatusResponse {
        status: status_str,
        cpu_usage: system.global_cpu_usage(),
        ram_allocated_mb: system.total_memory() / 1024 / 1024,
        ram_used_mb: system.used_memory() / 1024 / 1024,
        uptime_seconds: System::uptime(),
        active_players,
        max_players,
        recent_logs: state.logs.get_last_n(RECENT_LOG_LINES),
    })
}

fn parse_counts(response: &str) -> (u32, u32) {
    if let Some(rest) = response.trim().strip_prefix("There are ") {
        if let Some((online_str, rest)) = rest.split_once(" of a max of ") {
            if let Some((max_str, _)) = rest.split_once(" players online") {
                return (
                    online_str.parse().unwrap_or(0),
                    max_str.parse().unwrap_or(0),
                );
            }
        }
    }
    (0, 0)
}
