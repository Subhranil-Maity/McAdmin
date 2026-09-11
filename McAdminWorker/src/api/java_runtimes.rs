use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::java_manager::{JavaRuntime, JavaRuntimeInfo};
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateOrUpdateRuntimeRequest {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub is_default: bool,
}

pub async fn list_java_runtimes(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Vec<JavaRuntimeInfo>>, StatusCode> {
    let runtimes = state.java_manager.list_runtimes().await;
    Ok(Json(runtimes))
}

pub async fn scan_java_runtimes(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Vec<JavaRuntimeInfo>>, StatusCode> {
    if !user.is_superuser {
        return Err(StatusCode::FORBIDDEN);
    }

    match state.java_manager.scan_and_merge().await {
        Ok(list) => Ok(Json(list)),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn add_or_update_java_runtime(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(payload): Json<CreateOrUpdateRuntimeRequest>,
) -> Result<StatusCode, StatusCode> {
    if !user.is_superuser {
        return Err(StatusCode::FORBIDDEN);
    }

    let name = payload.name.trim();
    let path = payload.path.trim();

    if name.is_empty() || path.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let id = payload
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "custom-{}",
                name.to_lowercase()
                    .chars()
                    .map(|c| if c.is_alphanumeric() { c } else { '-' })
                    .collect::<String>()
            )
        });

    let runtime = JavaRuntime {
        id,
        name: name.to_string(),
        path: path.to_string(),
        is_default: payload.is_default,
    };

    match state.java_manager.add_or_update(runtime).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn delete_java_runtime(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthUser>,
) -> Result<StatusCode, StatusCode> {
    if !user.is_superuser {
        return Err(StatusCode::FORBIDDEN);
    }

    match state.java_manager.delete(&id).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
