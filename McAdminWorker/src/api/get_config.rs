use axum::{Json, extract::Path, extract::State, http::StatusCode};

use crate::{AppState, config::ConfigEntry};

pub(crate) async fn get_config(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<ConfigEntry>, StatusCode> {
    let value = state.config.get(&key).await.ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(ConfigEntry { key, value }))
}
