//! Installed content, Modrinth installs/identify, modpacks and job status.

use axum::{
    Extension, Json,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::error;

use super::{ApiError, api_error};
use crate::AppState;
use crate::auth::AuthUser;
use crate::content::{self, ContentKind, ContentListing};
use crate::instance_config::{InstanceConfig, ServerType};
use crate::instance_manager::{FABRIC_JAR_NAME, JarSource};
use crate::instance_runtime::LogBuffer;
use crate::jobs::{JobHandle, JobInfo};
use crate::modpack;
use crate::role_manager::Permission;

#[derive(Serialize)]
pub struct JobStarted {
    pub job_id: String,
}

fn forbidden() -> ApiError {
    api_error(StatusCode::FORBIDDEN, "forbidden", "Permission denied")
}

async fn require(
    state: &AppState,
    user: &AuthUser,
    id: &str,
    perm: Permission,
) -> Result<(), ApiError> {
    if state.config_manager.get_instance(id).await.is_none() {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Instance not found",
        ));
    }
    if user.has_permission(id, perm, &state.role_manager).await {
        Ok(())
    } else {
        Err(forbidden())
    }
}

/// (instance dir, config, console log buffer)
async fn instance_ctx(
    state: &AppState,
    id: &str,
) -> Result<(PathBuf, InstanceConfig, LogBuffer), ApiError> {
    let runtime_arc = state
        .instance_manager
        .get(id)
        .await
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not_found", "Instance not found"))?;
    let runtime = runtime_arc.lock().await;
    Ok((
        runtime.instance_dir.clone(),
        runtime.config.clone(),
        runtime.logs.clone(),
    ))
}

fn start_job(
    state: &AppState,
    id: &str,
    kind: &str,
    title: String,
    logs: Option<LogBuffer>,
) -> Result<JobHandle, ApiError> {
    state.jobs.start(id, kind, title, logs).map_err(|_| {
        api_error(
            StatusCode::CONFLICT,
            "job_running",
            "Another install is already running for this server; wait for it to finish.",
        )
    })
}

// ---------- jobs ----------

pub async fn get_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<JobInfo>, ApiError> {
    let job = state
        .jobs
        .get(&job_id)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not_found", "Job not found"))?;
    if !user
        .has_instance_access(&job.instance_id, &state.role_manager)
        .await
    {
        return Err(forbidden());
    }
    Ok(Json(job))
}

pub async fn list_instance_jobs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Vec<JobInfo>>, ApiError> {
    if !user.has_instance_access(&id, &state.role_manager).await {
        return Err(forbidden());
    }
    Ok(Json(state.jobs.for_instance(&id)))
}

// ---------- content ----------

#[derive(Serialize)]
pub struct ContentResponse {
    #[serde(flatten)]
    pub listing: ContentListing,
    pub server_type: ServerType,
    pub minecraft_version: Option<String>,
    pub loader_version: Option<String>,
}

pub async fn list_instance_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<ContentResponse>, ApiError> {
    require(&state, &user, &id, Permission::FilesRead).await?;
    let (dir, config, _) = instance_ctx(&state, &id).await?;
    Ok(Json(ContentResponse {
        listing: content::list(&dir).await,
        server_type: config.server_type,
        minecraft_version: config.minecraft_version,
        loader_version: config.loader_version,
    }))
}

#[derive(Deserialize)]
pub struct DeleteContentRequest {
    pub kind: String,
    #[serde(default)]
    pub filename: String,
}

pub async fn delete_instance_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<DeleteContentRequest>,
) -> Result<StatusCode, ApiError> {
    require(&state, &user, &id, Permission::FilesDelete).await?;
    let kind = ContentKind::parse(&req.kind).ok_or_else(|| {
        api_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Unknown content kind",
        )
    })?;
    if state.jobs.is_busy(&id) {
        return Err(api_error(
            StatusCode::CONFLICT,
            "job_running",
            "An install is running for this server",
        ));
    }
    let (dir, _, _) = instance_ctx(&state, &id).await?;
    content::delete(&dir, kind, &req.filename)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                api_error(StatusCode::NOT_FOUND, "not_found", "File not found")
            }
            std::io::ErrorKind::InvalidInput => {
                api_error(StatusCode::BAD_REQUEST, "bad_request", e.to_string())
            }
            _ => api_error(StatusCode::INTERNAL_SERVER_ERROR, "io_error", e.to_string()),
        })?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_instance_content_icon(
    State(state): State<AppState>,
    Path((id, project_id)): Path<(String, String)>,
    Extension(user): Extension<AuthUser>,
) -> Result<Response, StatusCode> {
    if !user.has_instance_access(&id, &state.role_manager).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let runtime_arc = state
        .instance_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let dir = runtime_arc.lock().await.instance_dir.clone();
    let path = content::find_icon(&dir, &project_id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let mime = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "private, max-age=86400")
        // Icons are untrusted; never let an SVG run scripts.
        .header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'",
        )
        .body(Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Deserialize)]
pub struct InstallRequest {
    pub version_id: String,
    pub kind: String,
}

pub async fn install_instance_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<InstallRequest>,
) -> Result<(StatusCode, Json<JobStarted>), ApiError> {
    require(&state, &user, &id, Permission::FilesUpload).await?;
    let kind = ContentKind::parse(&req.kind).ok_or_else(|| {
        api_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Unknown content kind",
        )
    })?;
    let (dir, config, logs) = instance_ctx(&state, &id).await?;
    if kind == ContentKind::Mod && config.server_type != ServerType::Fabric {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "unsupported",
            "Mods can only be installed on Fabric servers",
        ));
    }

    let label = match kind {
        ContentKind::Mod => "mod",
        ContentKind::Datapack => "datapack",
        ContentKind::Resourcepack => "resource pack",
    };
    let job = start_job(
        &state,
        &id,
        "install",
        format!("Installing {label}"),
        Some(logs),
    )?;
    let job_id = job.id.clone();
    let version_id = req.version_id.clone();

    tokio::spawn(async move {
        let ctx = content::InstallCtx {
            dir: &dir,
            server_type: config.server_type,
            minecraft_version: config.minecraft_version.as_deref(),
            modrinth: &state.modrinth,
            job: &job,
        };
        match content::install(&ctx, &version_id, kind).await {
            Ok(result) => {
                let n = result["installed"].as_array().map(|a| a.len()).unwrap_or(0);
                let msg = if n > 1 {
                    format!("Installed {n} files (including dependencies)")
                } else {
                    "Installed successfully".to_string()
                };
                job.succeed(msg, Some(result));
            }
            Err(e) => job.fail(e),
        }
    });

    Ok((StatusCode::ACCEPTED, Json(JobStarted { job_id })))
}

#[derive(Deserialize, Default)]
pub struct IdentifyRequest {
    #[serde(default)]
    pub force: bool,
}

pub async fn identify_instance_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    body: Option<Json<IdentifyRequest>>,
) -> Result<(StatusCode, Json<JobStarted>), ApiError> {
    require(&state, &user, &id, Permission::FilesUpload).await?;
    let force = body.map(|b| b.force).unwrap_or(false);
    let (dir, config, _) = instance_ctx(&state, &id).await?;
    // Identify is noisy; keep it out of the console.
    let job = start_job(
        &state,
        &id,
        "identify",
        "Identifying installed content".to_string(),
        None,
    )?;
    let job_id = job.id.clone();

    tokio::spawn(async move {
        let ctx = content::IdentifyCtx {
            dir: &dir,
            minecraft_version: config.minecraft_version.as_deref(),
            server_type: config.server_type,
            modrinth: &state.modrinth,
            job: &job,
        };
        match content::identify(&ctx, force).await {
            Ok(result) => {
                let msg = format!(
                    "Identified {} of {} file(s) on Modrinth",
                    result["identified"], result["total"]
                );
                job.succeed(msg, Some(result));
            }
            Err(e) => job.fail(e),
        }
    });

    Ok((StatusCode::ACCEPTED, Json(JobStarted { job_id })))
}

// ---------- modpacks ----------

/// Runs a modpack install job for an instance already marked `Installing`.
fn spawn_modpack_job(
    state: AppState,
    id: String,
    dir: PathBuf,
    version_id: String,
    job: JobHandle,
) {
    tokio::spawn(async move {
        match modpack::install(&dir, &state.modrinth, &version_id, &job).await {
            Ok(pack) => {
                let updated = state
                    .config_manager
                    .update_with(&id, |c| {
                        c.server_type = ServerType::Fabric;
                        c.jar_name = FABRIC_JAR_NAME.to_string();
                        c.minecraft_version = Some(pack.minecraft_version.clone());
                        c.loader_version = Some(pack.loader_version.clone());
                    })
                    .await;
                let updated = match updated {
                    Ok(u) => u,
                    Err(e) => {
                        error!("Failed to save config after modpack install: {e}");
                        None
                    }
                };
                state.instance_manager.end_install(&id, updated).await;
                job.succeed(
                    format!(
                        "Installed {} {} (Minecraft {}, Fabric {}). Start the server to finish setup.",
                        pack.name, pack.version_number, pack.minecraft_version, pack.loader_version
                    ),
                    Some(serde_json::json!({
                        "name": pack.name,
                        "version_number": pack.version_number,
                        "minecraft_version": pack.minecraft_version,
                        "loader_version": pack.loader_version,
                    })),
                );
            }
            Err(e) => {
                state.instance_manager.end_install(&id, None).await;
                job.fail(e);
            }
        }
    });
}

#[derive(Deserialize)]
pub struct InstallModpackRequest {
    pub version_id: String,
}

pub async fn install_instance_modpack(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<InstallModpackRequest>,
) -> Result<(StatusCode, Json<JobStarted>), ApiError> {
    require(&state, &user, &id, Permission::FilesUpload).await?;
    let (dir, config, logs) = instance_ctx(&state, &id).await?;
    if config.server_type != ServerType::Fabric {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "unsupported",
            "Modpacks can only be installed on Fabric servers",
        ));
    }
    let job = start_job(
        &state,
        &id,
        "modpack",
        "Installing modpack".to_string(),
        Some(logs),
    )?;
    if !state.instance_manager.begin_install(&id).await {
        job.fail("Stop the server before installing a modpack");
        return Err(api_error(
            StatusCode::CONFLICT,
            "server_running",
            "Stop the server before installing a modpack",
        ));
    }
    let job_id = job.id.clone();
    spawn_modpack_job(state, id, dir, req.version_id, job);
    Ok((StatusCode::ACCEPTED, Json(JobStarted { job_id })))
}

#[derive(Deserialize)]
pub struct CreateModpackInstanceRequest {
    pub name: String,
    pub version_id: String,
    #[serde(default)]
    pub ram_gb: Option<u32>,
    #[serde(default)]
    pub java_runtime: Option<String>,
    #[serde(default)]
    pub server_port: Option<u16>,
    #[serde(default)]
    pub rcon_port: Option<u16>,
}

#[derive(Serialize)]
pub struct CreateModpackResponse {
    #[serde(flatten)]
    pub instance: InstanceConfig,
    pub job_id: String,
}

pub async fn create_modpack_instance(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<CreateModpackInstanceRequest>,
) -> Result<(StatusCode, Json<CreateModpackResponse>), ApiError> {
    if !user.can_create_server() {
        return Err(forbidden());
    }
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Server name is required",
        ));
    }
    let ram_gb = req.ram_gb.unwrap_or(4);
    if ram_gb == 0 || ram_gb > 256 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Invalid RAM amount",
        ));
    }
    let java_runtime = req
        .java_runtime
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Validate the version up front so obvious errors don't leave a broken instance.
    let version = state
        .modrinth
        .version(&req.version_id, &crate::modrinth::no_wait_report)
        .await
        .map_err(super::modrinth_error)?;
    if !version.loaders.iter().any(|l| l == "fabric") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "unsupported",
            format!(
                "Only Fabric modpacks are supported (this one is for {})",
                version.loaders.join(", ")
            ),
        ));
    }
    let mc_hint = version.game_versions.first().cloned();

    let config = state
        .instance_manager
        .create_instance(
            name,
            ram_gb,
            mc_hint,
            java_runtime,
            req.server_port,
            req.rcon_port,
            JarSource::Managed(ServerType::Fabric),
            None,
            Some(user.user_id.clone()),
        )
        .await
        .map_err(|e| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "create_failed",
                e.to_string(),
            )
        })?;
    let _ = state
        .role_manager
        .init_instance(&config.id, Some(user.user_id.clone()))
        .await;

    let (dir, _, logs) = instance_ctx(&state, &config.id).await?;
    let job = start_job(
        &state,
        &config.id,
        "modpack",
        "Installing modpack".to_string(),
        Some(logs),
    )?;
    state.instance_manager.begin_install(&config.id).await;
    let job_id = job.id.clone();
    spawn_modpack_job(state.clone(), config.id.clone(), dir, req.version_id, job);

    Ok((
        StatusCode::CREATED,
        Json(CreateModpackResponse {
            instance: config,
            job_id,
        }),
    ))
}
