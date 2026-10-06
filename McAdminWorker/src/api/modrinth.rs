//! Modrinth proxy: the browser talks only to the worker, which applies the
//! shared rate limiter and caching.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

use super::{ApiError, modrinth_error};
use crate::AppState;
use crate::modrinth::{Project, SearchParams, Version, no_wait_report};

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub query: String,
    #[serde(default = "default_type")]
    pub project_type: String,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_limit")]
    pub limit: u32,
    pub index: Option<String>,
}

fn default_type() -> String {
    "mod".to_string()
}

fn default_limit() -> u32 {
    20
}

pub async fn modrinth_search(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let params = SearchParams {
        query: q.query,
        project_type: q.project_type,
        game_version: q.game_version,
        loader: q.loader,
        offset: q.offset,
        limit: q.limit,
        index: q.index,
    };
    state
        .modrinth
        .search(&params)
        .await
        .map(Json)
        .map_err(modrinth_error)
}

pub async fn modrinth_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Project>, ApiError> {
    state
        .modrinth
        .project(&id)
        .await
        .map(Json)
        .map_err(modrinth_error)
}

#[derive(Deserialize)]
pub struct VersionsQuery {
    pub game_version: Option<String>,
    pub loader: Option<String>,
}

pub async fn modrinth_project_versions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<VersionsQuery>,
) -> Result<Json<Vec<Version>>, ApiError> {
    let loaders: Vec<&str> = q
        .loader
        .as_deref()
        .filter(|s| !s.is_empty())
        .into_iter()
        .collect();
    let games: Vec<&str> = q
        .game_version
        .as_deref()
        .filter(|s| !s.is_empty())
        .into_iter()
        .collect();
    state
        .modrinth
        .project_versions(&id, &loaders, &games, &no_wait_report)
        .await
        .map(Json)
        .map_err(modrinth_error)
}
