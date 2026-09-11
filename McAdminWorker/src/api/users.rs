use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::user_manager::{UserPermissions, UserSummary};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct UserQuery {
    pub query: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PublicUserSummary {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub is_superuser: Option<bool>,
    pub can_create_server: Option<bool>,
    pub new_password: Option<String>,
}

pub async fn list_users(
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<UserQuery>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let all_users = state.user_manager.list_users().await;
    let query = params.query.map(|q| q.trim().to_lowercase());

    if auth_user.is_superuser {
        let filtered: Vec<UserSummary> = all_users
            .into_iter()
            .filter(|u| {
                if let Some(ref q) = query {
                    u.username.to_lowercase().contains(q)
                } else {
                    true
                }
            })
            .collect();
        Json(serde_json::json!(filtered))
    } else {
        let sanitized: Vec<PublicUserSummary> = all_users
            .into_iter()
            .filter(|u| {
                if let Some(ref q) = query {
                    u.username.to_lowercase().contains(q)
                } else {
                    true
                }
            })
            .map(|u| PublicUserSummary {
                id: u.id,
                username: u.username,
            })
            .collect();
        Json(serde_json::json!(sanitized))
    }
}

pub async fn update_user(
    AxumPath(user_id): AxumPath<String>,
    Extension(auth_user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<UserSummary>, (StatusCode, Json<serde_json::Value>)> {
    let is_self = auth_user.user_id == user_id;

    if !auth_user.is_superuser && !is_self {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Only superusers can modify other users." })),
        ));
    }

    if !auth_user.is_superuser {
        if payload.is_superuser.is_some() || payload.can_create_server.is_some() {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({ "error": "Only superusers can modify user privileges." })),
            ));
        }
    }

    let permissions = payload.can_create_server.map(|can_create| UserPermissions {
        can_create_server: can_create,
    });

    match state
        .user_manager
        .update_user(
            &user_id,
            payload.is_superuser,
            permissions,
            payload.new_password,
        )
        .await
    {
        Ok(summary) => Ok(Json(summary)),
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": err })),
        )),
    }
}

pub async fn delete_user(
    AxumPath(user_id): AxumPath<String>,
    Extension(auth_user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !auth_user.is_superuser {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Only superusers can delete users." })),
        ));
    }

    match state.user_manager.delete_user(&user_id).await {
        Ok(()) => Ok(Json(serde_json::json!({ "message": "User deleted successfully." }))),
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": err })),
        )),
    }
}
