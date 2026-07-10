use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::minecraft_files::{self, BannedPlayerEntry, OpEntry, WhitelistEntry};
use crate::{AppState, MinecraftServerState};

#[derive(Deserialize)]
pub(crate) struct PlayerActionRequest {
    player: String,
    reason: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct PlayerListResponse {
    players: Vec<PlayerInfo>,
}

#[derive(Serialize)]
pub(crate) struct PlayerInfo {
    name: String,
    uuid: String,
    op: bool,
    op_level: Option<i32>,
    whitelisted: bool,
    banned: bool,
}

#[derive(Serialize)]
pub(crate) struct PlayerActionResponse {
    status: String,
    method: String,
    message: String,
}

pub(crate) async fn get_all_players(
    State(state): State<AppState>,
) -> Result<Json<PlayerListResponse>, StatusCode> {
    let usercache = minecraft_files::read_usercache(&state.server_dir).await;
    let ops = minecraft_files::read_ops(&state.server_dir).await;
    let whitelisted = minecraft_files::read_whitelist_json(&state.server_dir).await;
    let banned = minecraft_files::read_banned_players(&state.server_dir).await;

    let op_map: HashMap<&str, i32> = ops.iter().map(|e| (e.uuid.as_str(), e.level)).collect();
    let whitelist_set: HashSet<&str> = whitelisted.iter().map(|e| e.uuid.as_str()).collect();
    let banned_set: HashSet<&str> = banned.iter().map(|e| e.uuid.as_str()).collect();

    let players = usercache
        .into_iter()
        .map(|entry| {
            let uuid = &entry.uuid;
            let is_op = op_map.contains_key(uuid.as_str());
            let op_level = op_map.get(uuid.as_str()).copied();
            let whitelisted = whitelist_set.contains(uuid.as_str());
            let banned = banned_set.contains(uuid.as_str());
            PlayerInfo {
                name: entry.name,
                uuid: entry.uuid,
                op: is_op,
                op_level,
                whitelisted,
                banned,
            }
        })
        .collect();

    Ok(Json(PlayerListResponse { players }))
}

pub(crate) async fn get_online_players(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    {
        let runtime = state.minecraft.lock().await;
        if runtime.state != MinecraftServerState::Online {
            return Err(StatusCode::CONFLICT);
        }
    }

    let response = state.rcon.execute("list").await.map_err(|e| {
        tracing::error!("RCON list failed: {e}");
        StatusCode::BAD_GATEWAY
    })?;

    Ok(Json(parse_online_players(&response)))
}

pub(crate) async fn ban_player(
    State(state): State<AppState>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_state = {
        let runtime = state.minecraft.lock().await;
        runtime.state
    };

    match runtime_state {
        MinecraftServerState::Starting => Err(StatusCode::CONFLICT),
        MinecraftServerState::Online => {
            let command = match &body.reason {
                Some(reason) if !reason.trim().is_empty() => {
                    format!("ban {} {}", player, reason.trim())
                }
                _ => format!("ban {}", player),
            };

            state.rcon.execute(&command).await.map_err(|e| {
                tracing::error!("RCON ban failed: {e}");
                StatusCode::BAD_GATEWAY
            })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "rcon".into(),
                message: format!("Banned {player}"),
            }))
        }
        MinecraftServerState::Offline => {
            let uuid = minecraft_files::find_uuid_in_cache(&state.server_dir, &player)
                .await
                .ok_or_else(|| {
                    tracing::error!(
                        "cannot ban {player} offline: player not found in usercache.json"
                    );
                    StatusCode::BAD_REQUEST
                })?;

            let mut banned = minecraft_files::read_banned_players(&state.server_dir).await;

            if banned.iter().any(|e| e.name.eq_ignore_ascii_case(&player)) {
                return Ok(Json(PlayerActionResponse {
                    status: "ok".into(),
                    method: "file".into(),
                    message: format!("{player} is already banned"),
                }));
            }

            let now = chrono::Utc::now();
            let created = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();

            banned.push(BannedPlayerEntry {
                uuid,
                name: player.clone(),
                created,
                source: "Server".into(),
                expires: "forever".into(),
                reason: body
                    .reason
                    .map(|r| r.trim().to_string())
                    .filter(|r| !r.is_empty()),
            });

            minecraft_files::write_banned_players(&state.server_dir, &banned)
                .await
                .map_err(|e| {
                    tracing::error!("failed to write banned-players.json: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "file".into(),
                message: format!("Added {player} to banned-players.json"),
            }))
        }
    }
}

pub(crate) async fn unban_player(
    State(state): State<AppState>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_state = {
        let runtime = state.minecraft.lock().await;
        runtime.state
    };

    match runtime_state {
        MinecraftServerState::Starting => Err(StatusCode::CONFLICT),
        MinecraftServerState::Online => {
            state
                .rcon
                .execute(&format!("pardon {player}"))
                .await
                .map_err(|e| {
                    tracing::error!("RCON pardon failed: {e}");
                    StatusCode::BAD_GATEWAY
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "rcon".into(),
                message: format!("Unbanned {player}"),
            }))
        }
        MinecraftServerState::Offline => {
            let mut banned = minecraft_files::read_banned_players(&state.server_dir).await;

            let pos = banned
                .iter()
                .position(|e| e.name.eq_ignore_ascii_case(&player));

            match pos {
                Some(idx) => {
                    banned.remove(idx);
                    minecraft_files::write_banned_players(&state.server_dir, &banned)
                        .await
                        .map_err(|e| {
                            tracing::error!("failed to write banned-players.json: {e}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?;

                    Ok(Json(PlayerActionResponse {
                        status: "ok".into(),
                        method: "file".into(),
                        message: format!("Removed {player} from banned-players.json"),
                    }))
                }
                None => Err(StatusCode::NOT_FOUND),
            }
        }
    }
}

pub(crate) async fn whitelist_player(
    State(state): State<AppState>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_state = {
        let runtime = state.minecraft.lock().await;
        runtime.state
    };

    match runtime_state {
        MinecraftServerState::Starting => Err(StatusCode::CONFLICT),
        MinecraftServerState::Online => {
            state
                .rcon
                .execute(&format!("whitelist add {player}"))
                .await
                .map_err(|e| {
                    tracing::error!("RCON whitelist add failed: {e}");
                    StatusCode::BAD_GATEWAY
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "rcon".into(),
                message: format!("Added {player} to whitelist"),
            }))
        }
        MinecraftServerState::Offline => {
            let uuid = minecraft_files::find_uuid_in_cache(&state.server_dir, &player)
                .await
                .ok_or_else(|| {
                    tracing::error!(
                        "cannot whitelist {player} offline: player not found in usercache.json"
                    );
                    StatusCode::BAD_REQUEST
                })?;

            let mut whitelist = minecraft_files::read_whitelist_json(&state.server_dir).await;

            if whitelist
                .iter()
                .any(|e| e.name.eq_ignore_ascii_case(&player))
            {
                return Ok(Json(PlayerActionResponse {
                    status: "ok".into(),
                    method: "file".into(),
                    message: format!("{player} is already whitelisted"),
                }));
            }

            whitelist.push(WhitelistEntry {
                uuid,
                name: player.clone(),
            });

            minecraft_files::write_whitelist_json(&state.server_dir, &whitelist)
                .await
                .map_err(|e| {
                    tracing::error!("failed to write whitelist.json: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "file".into(),
                message: format!("Added {player} to whitelist.json"),
            }))
        }
    }
}

pub(crate) async fn dewhitelist_player(
    State(state): State<AppState>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_state = {
        let runtime = state.minecraft.lock().await;
        runtime.state
    };

    match runtime_state {
        MinecraftServerState::Starting => Err(StatusCode::CONFLICT),
        MinecraftServerState::Online => {
            state
                .rcon
                .execute(&format!("whitelist remove {player}"))
                .await
                .map_err(|e| {
                    tracing::error!("RCON whitelist remove failed: {e}");
                    StatusCode::BAD_GATEWAY
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "rcon".into(),
                message: format!("Removed {player} from whitelist"),
            }))
        }
        MinecraftServerState::Offline => {
            let mut whitelist = minecraft_files::read_whitelist_json(&state.server_dir).await;

            let pos = whitelist
                .iter()
                .position(|e| e.name.eq_ignore_ascii_case(&player));

            match pos {
                Some(idx) => {
                    whitelist.remove(idx);
                    minecraft_files::write_whitelist_json(&state.server_dir, &whitelist)
                        .await
                        .map_err(|e| {
                            tracing::error!("failed to write whitelist.json: {e}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?;

                    Ok(Json(PlayerActionResponse {
                        status: "ok".into(),
                        method: "file".into(),
                        message: format!("Removed {player} from whitelist.json"),
                    }))
                }
                None => Err(StatusCode::NOT_FOUND),
            }
        }
    }
}

pub(crate) async fn op_player(
    State(state): State<AppState>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_state = {
        let runtime = state.minecraft.lock().await;
        runtime.state
    };

    match runtime_state {
        MinecraftServerState::Starting => Err(StatusCode::CONFLICT),
        MinecraftServerState::Online => {
            state
                .rcon
                .execute(&format!("op {player}"))
                .await
                .map_err(|e| {
                    tracing::error!("RCON op failed: {e}");
                    StatusCode::BAD_GATEWAY
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "rcon".into(),
                message: format!("Opped {player}"),
            }))
        }
        MinecraftServerState::Offline => {
            let uuid = minecraft_files::find_uuid_in_cache(&state.server_dir, &player)
                .await
                .ok_or_else(|| {
                    tracing::error!(
                        "cannot op {player} offline: player not found in usercache.json"
                    );
                    StatusCode::BAD_REQUEST
                })?;

            let mut ops = minecraft_files::read_ops(&state.server_dir).await;

            if ops.iter().any(|e| e.name.eq_ignore_ascii_case(&player)) {
                return Ok(Json(PlayerActionResponse {
                    status: "ok".into(),
                    method: "file".into(),
                    message: format!("{player} is already op"),
                }));
            }

            ops.push(OpEntry {
                uuid,
                name: player.clone(),
                level: 4,
                bypasses_player_limit: false,
            });

            minecraft_files::write_ops(&state.server_dir, &ops)
                .await
                .map_err(|e| {
                    tracing::error!("failed to write ops.json: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "file".into(),
                message: format!("Added {player} to ops.json"),
            }))
        }
    }
}

pub(crate) async fn deop_player(
    State(state): State<AppState>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_state = {
        let runtime = state.minecraft.lock().await;
        runtime.state
    };

    match runtime_state {
        MinecraftServerState::Starting => Err(StatusCode::CONFLICT),
        MinecraftServerState::Online => {
            state
                .rcon
                .execute(&format!("deop {player}"))
                .await
                .map_err(|e| {
                    tracing::error!("RCON deop failed: {e}");
                    StatusCode::BAD_GATEWAY
                })?;

            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: "rcon".into(),
                message: format!("Deopped {player}"),
            }))
        }
        MinecraftServerState::Offline => {
            let mut ops = minecraft_files::read_ops(&state.server_dir).await;

            let pos = ops
                .iter()
                .position(|e| e.name.eq_ignore_ascii_case(&player));

            match pos {
                Some(idx) => {
                    ops.remove(idx);
                    minecraft_files::write_ops(&state.server_dir, &ops)
                        .await
                        .map_err(|e| {
                            tracing::error!("failed to write ops.json: {e}");
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?;

                    Ok(Json(PlayerActionResponse {
                        status: "ok".into(),
                        method: "file".into(),
                        message: format!("Removed {player} from ops.json"),
                    }))
                }
                None => Err(StatusCode::NOT_FOUND),
            }
        }
    }
}

fn parse_online_players(rcon_response: &str) -> Vec<String> {
    if let Some((_, player_part)) = rcon_response.split_once(':') {
        let trimmed = player_part.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        return trimmed
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    Vec::new()
}
