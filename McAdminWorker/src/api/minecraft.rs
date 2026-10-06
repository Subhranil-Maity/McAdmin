use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};

use super::{ApiError, api_error};
use crate::AppState;
use crate::mc_versions::{FabricVersion, Source};

#[derive(Deserialize)]
pub struct VersionsQuery {
    #[serde(default)]
    pub include_snapshots: bool,
    /// Bypass the 1h cache (used by the UI's Retry button).
    #[serde(default)]
    pub refresh: bool,
}

#[derive(Serialize)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub release_time: String,
}

#[derive(Serialize)]
pub struct VersionsResponse {
    pub versions: Vec<VersionInfo>,
    pub latest_release: Option<String>,
    pub latest_snapshot: Option<String>,
    pub source: Source,
    pub fetched_at: Option<String>,
}

/// Official Minecraft versions (from Mojang, or the cached copy when offline).
pub async fn list_minecraft_versions(
    State(state): State<AppState>,
    Query(q): Query<VersionsQuery>,
) -> Result<Json<VersionsResponse>, ApiError> {
    let snap = state.catalog.snapshot(q.refresh).await;
    let Some(manifest) = snap.manifest else {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "version_list_unavailable",
            "The official Minecraft version list could not be loaded and no cached copy exists.",
        ));
    };
    let versions = manifest
        .versions
        .into_iter()
        .filter(|v| q.include_snapshots || v.kind == "release")
        .map(|v| VersionInfo {
            id: v.id,
            kind: v.kind,
            release_time: v.release_time,
        })
        .collect();
    Ok(Json(VersionsResponse {
        versions,
        latest_release: Some(manifest.latest.release).filter(|s| !s.is_empty()),
        latest_snapshot: Some(manifest.latest.snapshot).filter(|s| !s.is_empty()),
        source: snap.source,
        fetched_at: snap.fetched_at.map(|t| t.to_rfc3339()),
    }))
}

fn fabric_unreachable(e: std::io::Error) -> ApiError {
    api_error(StatusCode::BAD_GATEWAY, "fabric_unreachable", e.to_string())
}

#[derive(Deserialize)]
pub struct FabricGamesQuery {
    #[serde(default)]
    pub include_snapshots: bool,
}

pub async fn fabric_games(
    State(state): State<AppState>,
    Query(q): Query<FabricGamesQuery>,
) -> Result<Json<Vec<FabricVersion>>, ApiError> {
    let games = state
        .catalog
        .fabric_games()
        .await
        .map_err(fabric_unreachable)?;
    Ok(Json(
        games
            .into_iter()
            .filter(|g| q.include_snapshots || g.stable)
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct FabricLoadersQuery {
    pub game: String,
}

pub async fn fabric_loaders(
    State(state): State<AppState>,
    Query(q): Query<FabricLoadersQuery>,
) -> Result<Json<Vec<FabricVersion>>, ApiError> {
    state
        .catalog
        .fabric_loaders(q.game.trim())
        .await
        .map(Json)
        .map_err(fabric_unreachable)
}
