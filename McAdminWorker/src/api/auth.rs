use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::{Deserialize, Serialize};

use crate::auth::{generate_token, AuthUser};
use crate::user_manager::UserSummary;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserSummary,
}

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<serde_json::Value>)> {
    match state
        .user_manager
        .register(&payload.username, &payload.password)
        .await
    {
        Ok(user_summary) => {
            let token = generate_token(&user_summary, &state.jwt_secret).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Token generation failed: {e}") })),
                )
            })?;
            Ok(Json(AuthResponse {
                token,
                user: user_summary,
            }))
        }
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": err })),
        )),
    }
}

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<serde_json::Value>)> {
    match state
        .user_manager
        .authenticate(&payload.username, &payload.password)
        .await
    {
        Ok(user) => {
            let summary = UserSummary::from(&user);
            let token = generate_token(&summary, &state.jwt_secret).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Token generation failed: {e}") })),
                )
            })?;
            Ok(Json(AuthResponse {
                token,
                user: summary,
            }))
        }
        Err(err) => Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": err })),
        )),
    }
}

pub async fn me(
    Extension(auth_user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match state.user_manager.get_by_id(&auth_user.user_id).await {
        Some(summary) => Ok(Json(serde_json::json!({ "user": summary }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "User not found" })),
        )),
    }
}

pub async fn auth_health(State(state): State<AppState>) -> impl IntoResponse {
    let user_count = state.user_manager.count().await;
    Json(serde_json::json!({
        "status": "ok",
        "user_count": user_count,
        "is_first_run": user_count == 0,
    }))
}
