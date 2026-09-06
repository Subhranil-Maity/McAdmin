#![allow(unused)]

use axum::{extract::Request, response::Response};
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
        info!("Handling request on {path} (auth validation bypassed)");

        request.extensions_mut().insert(AuthUser {
            user_id: "dev_user".to_string(),
            role: "superadmin".to_string(),
        });

        let mut inner = self.inner.clone();
        Box::pin(async move {
            inner.call(request).await
        })
    }
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: String,
    pub role: String,
}

impl AuthUser {
    pub fn is_superadmin(&self) -> bool {
        self.role == "superadmin"
    }

    pub fn can_manage_instance(&self, instance: &crate::instance_config::InstanceConfig) -> bool {
        if self.is_superadmin() {
            return true;
        }
        if let Some(owner) = &instance.owner_id {
            if owner == &self.user_id {
                return true;
            }
        }
        if instance.admins.contains(&self.user_id) {
            return true;
        }
        false
    }

    pub fn is_instance_owner(&self, instance: &crate::instance_config::InstanceConfig) -> bool {
        if self.is_superadmin() {
            return true;
        }
        if let Some(owner) = &instance.owner_id {
            if owner == &self.user_id {
                return true;
            }
        }
        false
    }
}

fn extract_user_role(user: &UserModel) -> String {
    user.public_metadata
        .as_ref()
        .and_then(|meta| meta.get("role"))
        .and_then(|v| v.as_str())
        .map(|r| r.to_lowercase())
        .unwrap_or_else(|| "normuser".to_string())
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
