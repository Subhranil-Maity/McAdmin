use axum::{
    extract::Request,
    http::{header, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::{
    sync::Arc,
    task::{Context, Poll},
};
use tower::{Layer, Service};
use tracing::{debug, warn};

use crate::role_manager::{InstanceRole, RoleManager};
use crate::user_manager::{UserManager, UserPermissions, UserSummary};

pub const DEFAULT_JWT_SECRET: &str = "mcadmin_jwt_default_secret_change_in_production";
const PUBLIC_PATHS: &[&str] = &[
    "/",
    "/api/status",
    "/api/auth/health",
    "/api/auth/login",
    "/api/auth/register",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub username: String,
    pub is_superuser: bool,
    pub exp: usize,
    pub iat: usize,
}

pub fn generate_token(user: &UserSummary, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp() as usize;
    let exp = now + 7 * 24 * 3600; // 7 days expiration
    let claims = Claims {
        sub: user.id.clone(),
        username: user.username.clone(),
        is_superuser: user.is_superuser,
        iat: now,
        exp,
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_token(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let mut validation = jsonwebtoken::Validation::default();
    validation.validate_exp = true;
    let token_data = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(token_data.claims)
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: String,
    pub username: String,
    pub is_superuser: bool,
    pub permissions: UserPermissions,
}

impl AuthUser {
    pub fn can_create_server(&self) -> bool {
        self.is_superuser || self.permissions.can_create_server
    }

    pub async fn can_manage_instance(&self, instance_id: &str, role_mgr: &RoleManager) -> bool {
        if self.is_superuser {
            return true;
        }
        matches!(
            role_mgr.get_role(instance_id, &self.user_id).await,
            Some(InstanceRole::Owner) | Some(InstanceRole::Admin)
        )
    }

    pub async fn is_instance_owner(&self, instance_id: &str, role_mgr: &RoleManager) -> bool {
        if self.is_superuser {
            return true;
        }
        matches!(
            role_mgr.get_role(instance_id, &self.user_id).await,
            Some(InstanceRole::Owner)
        )
    }

    pub async fn has_instance_access(&self, instance_id: &str, role_mgr: &RoleManager) -> bool {
        if self.is_superuser {
            return true;
        }
        role_mgr.get_role(instance_id, &self.user_id).await.is_some()
    }
}

#[derive(Clone)]
pub struct JwtAuthLayer {
    jwt_secret: Arc<String>,
    user_manager: Arc<UserManager>,
}

impl JwtAuthLayer {
    pub fn new(jwt_secret: String, user_manager: Arc<UserManager>) -> Self {
        Self {
            jwt_secret: Arc::new(jwt_secret),
            user_manager,
        }
    }
}

impl<S> Layer<S> for JwtAuthLayer {
    type Service = JwtAuthMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        JwtAuthMiddleware {
            inner,
            jwt_secret: self.jwt_secret.clone(),
            user_manager: self.user_manager.clone(),
        }
    }
}

#[derive(Clone)]
pub struct JwtAuthMiddleware<S> {
    inner: S,
    jwt_secret: Arc<String>,
    user_manager: Arc<UserManager>,
}

impl<S> Service<Request> for JwtAuthMiddleware<S>
where
    S: Service<Request, Response = Response> + Send + Clone + 'static,
    S::Future: Send + 'static,
{
    type Response = Response;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut request: Request) -> Self::Future {
        let mut inner = self.inner.clone();
        let jwt_secret = self.jwt_secret.clone();
        let user_manager = self.user_manager.clone();

        Box::pin(async move {
            // CORS preflight and public paths bypass
            if request.method() == Method::OPTIONS {
                return inner.call(request).await;
            }

            let path = request.uri().path();
            if PUBLIC_PATHS.contains(&path) {
                return inner.call(request).await;
            }

            // Extract token from Authorization header or Cookie
            let token = extract_token(&request);

            let token = match token {
                Some(t) => t,
                None => {
                    warn!("Auth rejected on {path}: missing token");
                    let res = (
                        StatusCode::UNAUTHORIZED,
                        Json(serde_json::json!({
                            "error": "Authentication required. Missing token."
                        })),
                    )
                        .into_response();
                    return Ok(res);
                }
            };

            // Validate token
            let claims = match verify_token(&token, &jwt_secret) {
                Ok(c) => c,
                Err(err) => {
                    warn!("Auth rejected on {path}: token verification failed ({err})");
                    let res = (
                        StatusCode::UNAUTHORIZED,
                        Json(serde_json::json!({
                            "error": "Invalid or expired token."
                        })),
                    )
                        .into_response();
                    return Ok(res);
                }
            };

            // Lookup current user in user_manager for up-to-date permissions
            let user = match user_manager.get_user_by_id(&claims.sub).await {
                Some(u) => u,
                None => {
                    warn!("Auth rejected on {path}: user {} no longer exists", claims.sub);
                    let res = (
                        StatusCode::UNAUTHORIZED,
                        Json(serde_json::json!({
                            "error": "User account no longer exists."
                        })),
                    )
                        .into_response();
                    return Ok(res);
                }
            };

            let auth_user = AuthUser {
                user_id: user.id,
                username: user.username,
                is_superuser: user.is_superuser,
                permissions: user.permissions,
            };

            debug!(
                "Authenticated user '{}' (id: {}, superuser: {}) on {path}",
                auth_user.username, auth_user.user_id, auth_user.is_superuser
            );

            request.extensions_mut().insert(auth_user);
            inner.call(request).await
        })
    }
}

fn extract_token(request: &Request) -> Option<String> {
    // 1. Authorization: Bearer <token>
    if let Some(auth_val) = request.headers().get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ").or_else(|| auth_str.strip_prefix("bearer ")) {
                return Some(token.trim().to_string());
            }
        }
    }

    // 2. Cookie: mcadmin_token=<token>
    if let Some(cookie_val) = request.headers().get(header::COOKIE) {
        if let Ok(cookie_str) = cookie_val.to_str() {
            for pair in cookie_str.split(';') {
                let pair = pair.trim();
                if let Some(token) = pair.strip_prefix("mcadmin_token=") {
                    return Some(token.trim().to_string());
                }
                if let Some(token) = pair.strip_prefix("auth_token=") {
                    return Some(token.trim().to_string());
                }
            }
        }
    }

    // 3. Query param ?token=<token> (useful for WebSockets)
    if let Some(query) = request.uri().query() {
        for pair in query.split('&') {
            if let Some(token) = pair.strip_prefix("token=") {
                return Some(token.trim().to_string());
            }
        }
    }

    None
}
