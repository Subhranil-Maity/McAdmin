use axum::{
    Extension, Json,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path as FsPath, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate};
use tokio::fs;
use tracing::error;

use crate::auth::AuthUser;
use crate::instance_config::InstanceConfig;
use crate::instance_runtime::MinecraftServerState;
use crate::minecraft_files::{self, BannedPlayerEntry, OpEntry, WhitelistEntry};
use crate::AppState;

const RECENT_LOG_LINES: usize = 250;
const MAX_FILE_PREVIEW_SIZE: u64 = 5 * 1024 * 1024;
const TEMP_DIR_NAME: &str = ".tmp";

#[derive(Serialize)]
pub struct InstanceSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub server_port: u16,
    pub rcon_port: u16,
    pub ram_gb: u32,
    pub minecraft_version: Option<String>,
    pub created_at: String,
    pub owner_id: Option<String>,
    pub admins: Vec<String>,
    pub active_players: u32,
    pub max_players: u32,
    pub is_running: bool,
}

#[derive(Serialize)]
pub struct InstanceStatusResponse {
    pub id: String,
    pub name: String,
    pub status: String,
    pub server_port: u16,
    pub rcon_port: u16,
    pub cpu_usage: f32,
    pub ram_allocated_mb: u64,
    pub ram_used_mb: u64,
    pub uptime_seconds: u64,
    pub active_players: u32,
    pub max_players: u32,
    pub minecraft_version: Option<String>,
    pub recent_logs: Vec<String>,
}

#[derive(Deserialize)]
pub struct UpdateInstanceRequest {
    pub ram_gb: Option<u32>,
    #[serde(alias = "version")]
    pub minecraft_version: Option<String>,
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct CommandRequest {
    pub command: String,
}

#[derive(Serialize)]
pub struct CommandResponse {
    pub status: &'static str,
    pub command: String,
    pub response: String,
}

#[derive(Deserialize)]
pub struct UpdateAdminsRequest {
    pub admins: Vec<String>,
}

#[derive(Deserialize)]
pub struct DirQuery {
    pub path: Option<String>,
}

#[derive(Deserialize)]
pub struct ContentQuery {
    pub path: String,
}

#[derive(Deserialize)]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Serialize)]
pub struct DirListResponse {
    pub path: String,
    pub entries: Vec<DirEntryInfo>,
}

#[derive(Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub size: u64,
    pub modified: String,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Serialize)]
pub struct FileContentResponse {
    pub path: String,
    pub size: u64,
    pub content: String,
}

#[derive(Serialize)]
pub struct FileWriteResponse {
    pub status: String,
    pub path: String,
}

#[derive(Deserialize)]
pub struct PlayerActionRequest {
    pub player: String,
    pub reason: Option<String>,
}

#[derive(Serialize)]
pub struct PlayerInfo {
    pub name: String,
    pub uuid: String,
    pub op: bool,
    pub op_level: Option<i32>,
    pub whitelisted: bool,
    pub banned: bool,
}

#[derive(Serialize)]
pub struct PlayerListResponse {
    pub players: Vec<PlayerInfo>,
}

#[derive(Serialize)]
pub struct PlayerActionResponse {
    pub status: String,
    pub method: String,
    pub message: String,
}

pub async fn list_instances(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Vec<InstanceSummary>>, StatusCode> {
    let runtimes = state.instance_manager.list().await;
    let mut summaries = Vec::new();

    for runtime_arc in runtimes {
        let runtime = runtime_arc.lock().await;
        let is_running = runtime.state == MinecraftServerState::Online;
        let status = runtime.state.as_str().to_string();

        let (active_players, max_players) = if is_running {
            match runtime.rcon.execute("list").await {
                Ok(resp) => parse_counts(&resp),
                Err(_) => (0, 20),
            }
        } else {
            (0, 20)
        };

        summaries.push(InstanceSummary {
            id: runtime.config.id.clone(),
            name: runtime.config.name.clone(),
            status,
            server_port: runtime.config.server_port,
            rcon_port: runtime.config.rcon_port,
            ram_gb: runtime.config.ram_gb,
            minecraft_version: runtime.config.minecraft_version.clone(),
            created_at: runtime.config.created_at.clone(),
            owner_id: runtime.config.owner_id.clone(),
            admins: runtime.config.admins.clone(),
            active_players,
            max_players,
            is_running,
        });
    }

    summaries.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(summaries))
}

pub async fn create_instance(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<InstanceConfig>), StatusCode> {
    let mut name = None;
    let mut ram_gb = 2u32;
    let mut minecraft_version = None;
    let mut server_port = None;
    let mut rcon_port = None;
    let mut jar_data = None;
    let mut jar_filename = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("failed to read multipart field: {e}");
        StatusCode::BAD_REQUEST
    })? {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "name" => {
                name = Some(field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?);
            }
            "minecraft_version" | "version" => {
                if let Ok(text) = field.text().await {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        minecraft_version = Some(trimmed.to_string());
                    }
                }
            }
            "ram_gb" => {
                if let Ok(text) = field.text().await {
                    if let Ok(val) = text.parse::<u32>() {
                        ram_gb = val;
                    }
                }
            }
            "server_port" => {
                if let Ok(text) = field.text().await {
                    if let Ok(val) = text.parse::<u16>() {
                        server_port = Some(val);
                    }
                }
            }
            "rcon_port" => {
                if let Ok(text) = field.text().await {
                    if let Ok(val) = text.parse::<u16>() {
                        rcon_port = Some(val);
                    }
                }
            }
            "file" => {
                jar_filename = field.file_name().map(|s| s.to_string());
                let bytes = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
                jar_data = Some(bytes.to_vec());
            }
            _ => {}
        }
    }

    let name = name.ok_or(StatusCode::BAD_REQUEST)?;
    let jar_data = jar_data.ok_or(StatusCode::BAD_REQUEST)?;

    let config = state
        .instance_manager
        .create_instance(
            name,
            ram_gb,
            minecraft_version,
            server_port,
            rcon_port,
            &jar_data,
            jar_filename,
            Some(user.user_id),
        )
        .await
        .map_err(|e| {
            error!("Failed to create instance: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok((StatusCode::CREATED, Json(config)))
}

pub async fn get_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<InstanceConfig>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(config))
}

pub async fn delete_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<StatusCode, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.is_instance_owner(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    state
        .instance_manager
        .delete_instance(&id)
        .await
        .map_err(|e| {
            error!("Failed to delete instance: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_instance_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<InstanceStatusResponse>, StatusCode> {
    let runtime_arc = state
        .instance_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    let (status_str, process_id, server_port, rcon_port, ram_gb, name, minecraft_version, recent_logs) = {
        let runtime = runtime_arc.lock().await;
        (
            runtime.state.as_str().to_string(),
            runtime.process_id,
            runtime.config.server_port,
            runtime.config.rcon_port,
            runtime.config.ram_gb,
            runtime.config.name.clone(),
            runtime.config.minecraft_version.clone(),
            runtime.logs.get_last_n(RECENT_LOG_LINES),
        )
    };

    let is_online = status_str == "ONLINE";

    let (active_players, max_players) = if is_online {
        let runtime = runtime_arc.lock().await;
        match runtime.rcon.execute("list").await {
            Ok(resp) => parse_counts(&resp),
            Err(_) => (0, 20),
        }
    } else {
        (0, 20)
    };

    let ram_allocated_mb = (ram_gb as u64) * 1024;

    let (cpu_usage, ram_used_mb, uptime_seconds) = if let Some(pid_u32) = process_id {
        let pid = Pid::from_u32(pid_u32);
        let mut system = state.system.lock().await;
        system.refresh_cpu_usage();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );

        if let Some(proc) = system.process(pid) {
            let cpus_count = system.cpus().len().max(1) as f32;
            let cpu = (proc.cpu_usage() / cpus_count).clamp(0.0, 100.0);
            let mem = proc.memory() / 1024 / 1024;
            let uptime = proc.run_time();
            (cpu, mem, uptime)
        } else {
            (0.0, 0, 0)
        }
    } else {
        (0.0, 0, 0)
    };

    Ok(Json(InstanceStatusResponse {
        id,
        name,
        status: status_str,
        server_port,
        rcon_port,
        cpu_usage,
        ram_allocated_mb,
        ram_used_mb,
        uptime_seconds,
        active_players,
        max_players,
        minecraft_version,
        recent_logs,
    }))
}

pub async fn start_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<StatusCode, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    state.instance_manager.start_instance(&id).await.map_err(|e| {
        error!("Failed to start instance: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::OK)
}

pub async fn stop_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<StatusCode, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    state.instance_manager.stop_instance(&id).await.map_err(|e| {
        error!("Failed to stop instance: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::OK)
}

pub async fn command_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(payload): Json<CommandRequest>,
) -> Result<Json<CommandResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let command = payload.command.trim();
    if command.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_arc = state
        .instance_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    let response = {
        let runtime = runtime_arc.lock().await;
        if runtime.state != MinecraftServerState::Online {
            return Err(StatusCode::CONFLICT);
        }
        runtime.rcon.execute(command).await.map_err(|e| {
            error!("RCON command error: {e}");
            StatusCode::BAD_GATEWAY
        })?
    };

    Ok(Json(CommandResponse {
        status: "ok",
        command: command.to_string(),
        response,
    }))
}

pub async fn update_instance_admins(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(payload): Json<UpdateAdminsRequest>,
) -> Result<Json<InstanceConfig>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.is_instance_owner(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let updated = state
        .config_manager
        .update_instance_admins(&id, payload.admins)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    if let Some(runtime_arc) = state.instance_manager.get(&id).await {
        let mut runtime = runtime_arc.lock().await;
        runtime.config.admins = updated.admins.clone();
    }

    Ok(Json(updated))
}

pub async fn update_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(payload): Json<UpdateInstanceRequest>,
) -> Result<Json<InstanceConfig>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    if let Some(ram) = payload.ram_gb {
        if ram == 0 || ram > 256 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let trimmed_version = payload.minecraft_version.map(|v| v.trim().to_string());

    let updated = state
        .config_manager
        .update_instance_config(
            &id,
            payload.ram_gb,
            trimmed_version,
            payload.name,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    if let Some(runtime_arc) = state.instance_manager.get(&id).await {
        let mut runtime = runtime_arc.lock().await;
        runtime.config.ram_gb = updated.ram_gb;
        runtime.config.minecraft_version = updated.minecraft_version.clone();
        runtime.config.name = updated.name.clone();
    }

    Ok(Json(updated))
}

pub async fn get_instance_properties(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<HashMap<String, String>>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let properties_path = state.home_dir.join(&config.folder).join("server.properties");
    let content = fs::read_to_string(&properties_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    let map = parse_properties(&content);
    Ok(Json(map))
}

pub async fn update_instance_properties(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(properties): Json<HashMap<String, String>>,
) -> Result<Json<HashMap<String, String>>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let properties_path = state.home_dir.join(&config.folder).join("server.properties");

    let mut lines = Vec::new();
    lines.push("#Minecraft server properties".to_string());
    let mut sorted: Vec<_> = properties.iter().collect();
    sorted.sort_by_key(|(k, _)| *k);

    for (k, v) in sorted {
        lines.push(format!("{k}={v}"));
    }

    fs::write(&properties_path, lines.join("\n") + "\n")
        .await
        .map_err(|e| {
            error!("Failed to write properties: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(properties))
}

pub async fn get_instance_players(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<PlayerListResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let instance_dir = state.home_dir.join(&config.folder);
    let usercache = minecraft_files::read_usercache(&instance_dir).await;
    let ops = minecraft_files::read_ops(&instance_dir).await;
    let whitelisted = minecraft_files::read_whitelist_json(&instance_dir).await;
    let banned = minecraft_files::read_banned_players(&instance_dir).await;

    let op_map: HashMap<&str, i32> = ops.iter().map(|e| (e.uuid.as_str(), e.level)).collect();
    let whitelist_set: HashSet<&str> = whitelisted.iter().map(|e| e.uuid.as_str()).collect();
    let banned_set: HashSet<&str> = banned.iter().map(|e| e.uuid.as_str()).collect();

    let players = usercache
        .into_iter()
        .map(|entry| {
            let uuid = &entry.uuid;
            let is_op = op_map.contains_key(uuid.as_str());
            let op_level = op_map.get(uuid.as_str()).copied();
            let is_whitelisted = whitelist_set.contains(uuid.as_str());
            let is_banned = banned_set.contains(uuid.as_str());
            PlayerInfo {
                name: entry.name,
                uuid: entry.uuid,
                op: is_op,
                op_level,
                whitelisted: is_whitelisted,
                banned: is_banned,
            }
        })
        .collect();

    Ok(Json(PlayerListResponse { players }))
}

pub async fn get_instance_online_players(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let runtime_arc = state
        .instance_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    let response = {
        let runtime = runtime_arc.lock().await;
        if runtime.state != MinecraftServerState::Online {
            return Err(StatusCode::CONFLICT);
        }
        runtime.rcon.execute("list").await.map_err(|e| {
            error!("RCON list failed: {e}");
            StatusCode::BAD_GATEWAY
        })?
    };

    Ok(Json(parse_online_players(&response)))
}

pub async fn instance_player_action(
    State(state): State<AppState>,
    Path((id, action)): Path<(String, String)>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<PlayerActionRequest>,
) -> Result<Json<PlayerActionResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let player = body.player.trim().to_string();
    if player.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let runtime_arc = state
        .instance_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    let is_online = {
        let runtime = runtime_arc.lock().await;
        runtime.state == MinecraftServerState::Online
    };

    let instance_dir = state.home_dir.join(&config.folder);

    match action.as_str() {
        "ban" => {
            if is_online {
                let cmd = match &body.reason {
                    Some(r) if !r.trim().is_empty() => format!("ban {player} {}", r.trim()),
                    _ => format!("ban {player}"),
                };
                let runtime = runtime_arc.lock().await;
                runtime.rcon.execute(&cmd).await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            } else {
                let uuid = minecraft_files::find_uuid_in_cache(&instance_dir, &player)
                    .await
                    .ok_or(StatusCode::BAD_REQUEST)?;
                let mut banned = minecraft_files::read_banned_players(&instance_dir).await;
                if !banned.iter().any(|e| e.name.eq_ignore_ascii_case(&player)) {
                    banned.push(BannedPlayerEntry {
                        uuid,
                        name: player.clone(),
                        created: Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
                        source: "Server".into(),
                        expires: "forever".into(),
                        reason: body.reason,
                    });
                    minecraft_files::write_banned_players(&instance_dir, &banned)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: if is_online { "rcon".into() } else { "file".into() },
                message: format!("Banned {player}"),
            }))
        }
        "unban" => {
            if is_online {
                let runtime = runtime_arc.lock().await;
                runtime.rcon.execute(&format!("pardon {player}")).await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            } else {
                let mut banned = minecraft_files::read_banned_players(&instance_dir).await;
                if let Some(pos) = banned.iter().position(|e| e.name.eq_ignore_ascii_case(&player)) {
                    banned.remove(pos);
                    minecraft_files::write_banned_players(&instance_dir, &banned)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: if is_online { "rcon".into() } else { "file".into() },
                message: format!("Unbanned {player}"),
            }))
        }
        "whitelist" => {
            if is_online {
                let runtime = runtime_arc.lock().await;
                runtime.rcon.execute(&format!("whitelist add {player}")).await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            } else {
                let uuid = minecraft_files::find_uuid_in_cache(&instance_dir, &player)
                    .await
                    .ok_or(StatusCode::BAD_REQUEST)?;
                let mut whitelist = minecraft_files::read_whitelist_json(&instance_dir).await;
                if !whitelist.iter().any(|e| e.name.eq_ignore_ascii_case(&player)) {
                    whitelist.push(WhitelistEntry { uuid, name: player.clone() });
                    minecraft_files::write_whitelist_json(&instance_dir, &whitelist)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: if is_online { "rcon".into() } else { "file".into() },
                message: format!("Whitelisted {player}"),
            }))
        }
        "dewhitelist" => {
            if is_online {
                let runtime = runtime_arc.lock().await;
                runtime.rcon.execute(&format!("whitelist remove {player}")).await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            } else {
                let mut whitelist = minecraft_files::read_whitelist_json(&instance_dir).await;
                if let Some(pos) = whitelist.iter().position(|e| e.name.eq_ignore_ascii_case(&player)) {
                    whitelist.remove(pos);
                    minecraft_files::write_whitelist_json(&instance_dir, &whitelist)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: if is_online { "rcon".into() } else { "file".into() },
                message: format!("Removed {player} from whitelist"),
            }))
        }
        "op" => {
            if is_online {
                let runtime = runtime_arc.lock().await;
                runtime.rcon.execute(&format!("op {player}")).await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            } else {
                let uuid = minecraft_files::find_uuid_in_cache(&instance_dir, &player)
                    .await
                    .ok_or(StatusCode::BAD_REQUEST)?;
                let mut ops = minecraft_files::read_ops(&instance_dir).await;
                if !ops.iter().any(|e| e.name.eq_ignore_ascii_case(&player)) {
                    ops.push(OpEntry {
                        uuid,
                        name: player.clone(),
                        level: 4,
                        bypasses_player_limit: false,
                    });
                    minecraft_files::write_ops(&instance_dir, &ops)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: if is_online { "rcon".into() } else { "file".into() },
                message: format!("Opped {player}"),
            }))
        }
        "deop" => {
            if is_online {
                let runtime = runtime_arc.lock().await;
                runtime.rcon.execute(&format!("deop {player}")).await.map_err(|_| StatusCode::BAD_GATEWAY)?;
            } else {
                let mut ops = minecraft_files::read_ops(&instance_dir).await;
                if let Some(pos) = ops.iter().position(|e| e.name.eq_ignore_ascii_case(&player)) {
                    ops.remove(pos);
                    minecraft_files::write_ops(&instance_dir, &ops)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            Ok(Json(PlayerActionResponse {
                status: "ok".into(),
                method: if is_online { "rcon".into() } else { "file".into() },
                message: format!("Deopped {player}"),
            }))
        }
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

pub async fn list_instance_files(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Query(query): Query<DirQuery>,
) -> Result<Json<DirListResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let instance_dir = state.home_dir.join(&config.folder);
    let request_path = query.path.unwrap_or_else(|| "/".to_string());
    let resolved = safe_join(&instance_dir, &request_path)?;

    let mut read_dir = fs::read_dir(&resolved).await.map_err(|_| StatusCode::NOT_FOUND)?;
    let mut entries = Vec::new();

    while let Some(entry) = read_dir.next_entry().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let meta = fs::symlink_metadata(entry.path()).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let entry_type = if meta.file_type().is_dir() {
            "dir"
        } else if meta.file_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };

        entries.push(DirEntryInfo {
            name,
            size: meta.len(),
            modified: meta
                .modified()
                .map(|t| {
                    let dt: DateTime<Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default(),
            entry_type: entry_type.to_string(),
        });
    }

    entries.sort_by(|a, b| {
        let a_dir = a.entry_type == "dir";
        let b_dir = b.entry_type == "dir";
        if a_dir != b_dir {
            b_dir.cmp(&a_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    let display_path = normalize_display_path(&instance_dir, &resolved);

    Ok(Json(DirListResponse {
        path: display_path,
        entries,
    }))
}

pub async fn get_instance_file_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Query(query): Query<ContentQuery>,
) -> Result<Json<FileContentResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let instance_dir = state.home_dir.join(&config.folder);
    let resolved = safe_join(&instance_dir, &query.path)?;

    let meta = fs::symlink_metadata(&resolved).await.map_err(|_| StatusCode::NOT_FOUND)?;
    if meta.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if meta.len() > MAX_FILE_PREVIEW_SIZE {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let data = fs::read(&resolved).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !is_likely_text(&data) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let content = String::from_utf8_lossy(&data).to_string();
    let display_path = normalize_display_path(&instance_dir, &resolved);

    Ok(Json(FileContentResponse {
        path: display_path,
        size: meta.len(),
        content,
    }))
}

pub async fn write_instance_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<WriteRequest>,
) -> Result<Json<FileWriteResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let instance_dir = state.home_dir.join(&config.folder);
    let resolved = safe_join(&instance_dir, &body.path)?;

    if !body.force && fs::try_exists(&resolved).await.unwrap_or(false) {
        return Err(StatusCode::CONFLICT);
    }

    let display_path = normalize_display_path(&instance_dir, &resolved);
    write_file_inner(&instance_dir, &resolved, body.content.as_bytes()).await?;

    Ok(Json(FileWriteResponse {
        status: "ok".into(),
        path: display_path,
    }))
}

pub async fn upload_instance_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Result<Json<FileWriteResponse>, StatusCode> {
    let config = state
        .config_manager
        .get_instance(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    if !user.can_manage_instance(&config) {
        return Err(StatusCode::FORBIDDEN);
    }

    let instance_dir = state.home_dir.join(&config.folder);

    let mut request_path: Option<String> = None;
    let mut file_data: Option<Vec<u8>> = None;
    let mut force = false;

    while let Some(field) = multipart.next_field().await.map_err(|_| StatusCode::BAD_REQUEST)? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "path" => {
                request_path = Some(field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?);
            }
            "file" => {
                let bytes = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
                file_data = Some(bytes.to_vec());
            }
            "force" => {
                let val = field.text().await.unwrap_or_default();
                force = val == "true" || val == "1";
            }
            _ => {}
        }
    }

    let path = request_path.ok_or(StatusCode::BAD_REQUEST)?;
    let data = file_data.ok_or(StatusCode::BAD_REQUEST)?;

    let resolved = safe_join(&instance_dir, &path)?;
    if !force && fs::try_exists(&resolved).await.unwrap_or(false) {
        return Err(StatusCode::CONFLICT);
    }

    let display_path = normalize_display_path(&instance_dir, &resolved);
    write_file_inner(&instance_dir, &resolved, &data).await?;

    Ok(Json(FileWriteResponse {
        status: "ok".into(),
        path: display_path,
    }))
}

fn parse_counts(response: &str) -> (u32, u32) {
    if let Some(rest) = response.trim().strip_prefix("There are ") {
        if let Some((online_str, rest)) = rest.split_once(" of a max of ") {
            if let Some((max_str, _)) = rest.split_once(" players online") {
                return (
                    online_str.parse().unwrap_or(0),
                    max_str.parse().unwrap_or(20),
                );
            }
        }
    }
    (0, 20)
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

fn parse_properties(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    map
}

fn safe_join(base: &FsPath, request_path: &str) -> Result<PathBuf, StatusCode> {
    let clean = request_path.trim_start_matches('/');
    if clean.is_empty() {
        return Ok(base.to_path_buf());
    }

    for component in FsPath::new(clean).components() {
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

fn normalize_display_path(base: &FsPath, full: &FsPath) -> String {
    let base_str = base.to_string_lossy().to_lowercase();
    let full_str = full.to_string_lossy();
    if full_str.to_lowercase().starts_with(&base_str) {
        let relative = &full_str[base_str.len()..];
        let relative = relative.trim_start_matches('\\').trim_start_matches('/');
        if relative.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", relative.replace('\\', "/"))
        }
    } else {
        "/".to_string()
    }
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

async fn write_file_inner(base: &FsPath, destination: &FsPath, data: &[u8]) -> Result<(), StatusCode> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let temp_dir = base.join(TEMP_DIR_NAME);
    fs::create_dir_all(&temp_dir).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let original_name = destination
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let temp_path = temp_dir.join(format!("{}_{}", ts, original_name));

    fs::write(&temp_path, data).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Err(_) = fs::rename(&temp_path, destination).await {
        let _ = fs::remove_file(&temp_path).await;
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    Ok(())
}
