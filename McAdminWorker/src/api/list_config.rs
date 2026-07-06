use axum::{Json, extract::State};

use crate::{AppState, config::ConfigEntry};

pub(crate) async fn list_config(State(state): State<AppState>) -> Json<Vec<ConfigEntry>> {
    Json(state.config.list().await)
}
