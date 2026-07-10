use axum::{body::Body, extract::Request, http::StatusCode, response::Response};
use clerk_rs::{
    ClerkConfiguration,
    apis::users_api::User as UsersApi,
    clerk::Clerk,
    models::User as UserModel,
    validators::{authorizer::validate_jwt, jwks::MemoryCacheJwksProvider},
};
use futures_util::future::BoxFuture;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    task::{Context, Poll},
    time::{Duration, Instant},
};
use tokio::sync::RwLock;
use tower::{Layer, Service};
use tracing::{info, warn};

const PUBLIC_PATHS: &[&str] = &["/", "/api/status"];
const ROLE_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

struct CacheEntry {
    role: String,
    expires_at: Instant,
}

#[derive(Clone)]
pub struct RoleCache {
    inner: Arc<RwLock<HashMap<String, CacheEntry>>>,
}

impl RoleCache {
    fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn get(&self, user_id: &str) -> Option<(String, Duration)> {
        let cache = self.inner.read().await;
        cache.get(user_id).and_then(|entry| {
            let now = Instant::now();
            if now < entry.expires_at {
                let ttl = entry.expires_at.duration_since(now);
                Some((entry.role.clone(), ttl))
            } else {
                None
            }
        })
    }

    async fn insert(&self, user_id: &str, role: &str) {
        let mut cache = self.inner.write().await;
        cache.insert(
            user_id.to_owned(),
            CacheEntry {
                role: role.to_owned(),
                expires_at: Instant::now() + ROLE_CACHE_TTL,
            },
        );
    }
}

#[derive(Clone)]
pub struct ClerkAuthLayer {
    clerk: Clerk,
    jwks_provider: Arc<MemoryCacheJwksProvider>,
    public_paths: Arc<HashSet<&'static str>>,
    role_cache: RoleCache,
}

impl ClerkAuthLayer {
    pub fn new(clerk_secret_key: String) -> Self {
        let config = ClerkConfiguration::new(None, None, Some(clerk_secret_key), None);
        let clerk = Clerk::new(config);
        let jwks_provider = MemoryCacheJwksProvider::new(clerk.clone());

        let public_paths = PUBLIC_PATHS.iter().copied().collect();

        Self {
            clerk,
            jwks_provider: Arc::new(jwks_provider),
            public_paths: Arc::new(public_paths),
            role_cache: RoleCache::new(),
        }
    }
}

impl<S> Layer<S> for ClerkAuthLayer {
    type Service = ClerkAuthService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        ClerkAuthService {
            inner,
            clerk: self.clerk.clone(),
            jwks_provider: self.jwks_provider.clone(),
            public_paths: self.public_paths.clone(),
            role_cache: self.role_cache.clone(),
        }
    }
}

#[derive(Clone)]
pub struct ClerkAuthService<S> {
    inner: S,
    clerk: Clerk,
    jwks_provider: Arc<MemoryCacheJwksProvider>,
    public_paths: Arc<HashSet<&'static str>>,
    role_cache: RoleCache,
}

impl<S> Service<Request> for ClerkAuthService<S>
where
    S: Service<Request, Response = Response> + Send + 'static + Clone,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut request: Request) -> Self::Future {
        let path = request.uri().path().to_owned();

        if self.public_paths.contains(path.as_str()) {
            let mut inner = self.inner.clone();
            return Box::pin(async move { inner.call(request).await });
        }

        let auth_header = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());

        let token = match auth_header {
            Some(header) => header.strip_prefix("Bearer ").unwrap_or(&header).to_owned(),
            None => {
                let cookie_token = request
                    .headers()
                    .get("cookie")
                    .and_then(|v| v.to_str().ok())
                    .and_then(parse_session_cookie);

                match cookie_token {
                    Some(t) => t,
                    None => {
                        warn!(
                            "auth rejected on {path}: no Authorization header and no __session cookie"
                        );
                        return Box::pin(async {
                            Ok(Response::builder()
                                .status(StatusCode::UNAUTHORIZED)
                                .body(Body::from("Missing Authorization header or session cookie"))
                                .unwrap())
                        });
                    }
                }
            }
        };

        let jwks_provider = self.jwks_provider.clone();
        let clerk = self.clerk.clone();
        let role_cache = self.role_cache.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            let jwt = match validate_jwt(&token, jwks_provider).await {
                Ok(jwt) => jwt,
                Err(e) => {
                    warn!("auth rejected on {path}: JWT validation failed: {e}");
                    return Ok(Response::builder()
                        .status(StatusCode::UNAUTHORIZED)
                        .body(Body::from("Invalid or expired token"))
                        .unwrap());
                }
            };

            let role = match role_cache.get(&jwt.sub).await {
                Some((role, ttl)) => {
                    info!(
                        "role cache hit for user={}: role={role} ttl={:.0}s",
                        jwt.sub,
                        ttl.as_secs_f64()
                    );
                    role
                }
                None => {
                    info!("role cache miss for user={}", jwt.sub);
                    let user = match UsersApi::get_user(&clerk, &jwt.sub).await {
                        Ok(user) => user,
                        Err(e) => {
                            warn!(
                                "auth rejected on {path}: failed to fetch user {}: {e}",
                                jwt.sub
                            );
                            return Ok(Response::builder()
                                .status(StatusCode::UNAUTHORIZED)
                                .body(Body::from("Failed to fetch user"))
                                .unwrap());
                        }
                    };

                    match extract_admin_role(&user) {
                        Ok(role) => {
                            role_cache.insert(&jwt.sub, &role).await;
                            role
                        }
                        Err((status, found)) => {
                            warn!(
                                "auth rejected on {path}: user={} expected role admin|owner, found {found}",
                                jwt.sub
                            );
                            return Ok(Response::builder()
                                .status(status)
                                .body(Body::from("Forbidden: admin or owner role required"))
                                .unwrap());
                        }
                    }
                }
            };

            info!("auth OK on {path}: user={} role={role}", jwt.sub);
            request.extensions_mut().insert(jwt);
            inner.call(request).await
        })
    }
}

fn extract_admin_role(user: &UserModel) -> Result<String, (StatusCode, String)> {
    let public_metadata = user
        .public_metadata
        .as_ref()
        .ok_or((StatusCode::FORBIDDEN, "no public_metadata".into()))?;

    let role = public_metadata
        .get("role")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::FORBIDDEN, "no role in public_metadata".into()))?
        .to_lowercase();

    if role == "admin" || role == "owner" {
        Ok(role.to_owned())
    } else {
        Err((StatusCode::FORBIDDEN, role.to_owned()))
    }
}

fn parse_session_cookie(cookie_header: &str) -> Option<String> {
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("__session=") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}
