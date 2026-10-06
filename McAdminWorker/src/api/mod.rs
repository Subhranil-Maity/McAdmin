pub mod auth;
pub mod content;
mod health;
pub mod instances;
pub mod java_runtimes;
pub mod minecraft;
pub mod modrinth;
pub mod users;

pub(crate) use health::health;

use axum::{Json, http::StatusCode};

/// JSON error body: `{ "error": <code>, "message": <human readable> }`.
pub type ApiError = (StatusCode, Json<serde_json::Value>);

pub fn api_error(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message.into() })),
    )
}

pub fn modrinth_error(e: crate::modrinth::ModrinthError) -> ApiError {
    use crate::modrinth::ModrinthError;
    match e {
        ModrinthError::Unreachable(_) => api_error(StatusCode::BAD_GATEWAY, "modrinth_unreachable", e.to_string()),
        ModrinthError::NotFound => api_error(StatusCode::NOT_FOUND, "not_found", e.to_string()),
        ModrinthError::Api(429, _) => api_error(StatusCode::TOO_MANY_REQUESTS, "modrinth_rate_limited", e.to_string()),
        ModrinthError::Api(code, _) if (400..500).contains(&code) => {
            api_error(StatusCode::BAD_REQUEST, "modrinth_error", e.to_string())
        }
        ModrinthError::Api(_, _) => api_error(StatusCode::BAD_GATEWAY, "modrinth_error", e.to_string()),
    }
}
