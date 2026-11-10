//! Serves the built McAdminConsole (a static SPA) from the worker itself, so a
//! deployment can be a single process on a single port with the console and
//! `/api` on the same origin.
//!
//! Enabled by setting `WEB_ROOT` to the console's build output (`McAdminConsole/dist`).
//! - Real files are served from `WEB_ROOT`, using precompressed `.br` / `.gz`
//!   siblings when the browser accepts them (see `scripts/compress.ts`).
//! - Any other non-`/api` path returns `index.html` so client-side routes such as
//!   `/dashboard/<uuid>/console` survive a reload.
//! - `/config.js` is generated from `WEB_BACKEND_URL` (default `same-origin`),
//!   which overrides the placeholder shipped in the build.
//! - Unknown `/api/*` paths still get a JSON 404 instead of the HTML page.

use axum::{
    Json, Router,
    body::Body,
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use std::path::PathBuf;
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

/// Static console configuration, resolved from the environment at startup.
#[derive(Clone)]
pub struct WebConfig {
    root: PathBuf,
    config_js: String,
}

impl WebConfig {
    /// Reads `WEB_ROOT` / `WEB_BACKEND_URL`. Returns `None` (API-only mode) when
    /// `WEB_ROOT` is unset, or when it does not contain an `index.html`.
    pub fn from_env() -> Option<Self> {
        let root = std::env::var("WEB_ROOT")
            .ok()
            .filter(|s| !s.trim().is_empty())?;
        let root = PathBuf::from(root.trim());
        if !root.join("index.html").is_file() {
            warn!(
                "WEB_ROOT={} has no index.html (run `bun run build` in McAdminConsole); web console disabled",
                root.display()
            );
            return None;
        }

        let backend_url =
            std::env::var("WEB_BACKEND_URL").unwrap_or_else(|_| "same-origin".to_string());
        let config_js = format!(
            "window.__MCADMIN_CONFIG__ = {};\n",
            serde_json::json!({ "backendUrl": backend_url.trim() })
        );

        info!(
            "Serving web console from {} (backendUrl: {})",
            root.display(),
            backend_url.trim()
        );
        Some(Self { root, config_js })
    }
}

/// Adds the console routes (`/config.js` and the SPA fallback) to `router`.
pub fn mount<S>(router: Router<S>, web: WebConfig) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let config_js = web.config_js.clone();
    let index = web.root.join("index.html");
    let files = ServeDir::new(&web.root)
        .precompressed_br()
        .precompressed_gzip()
        .fallback(
            ServeFile::new(&index)
                .precompressed_br()
                .precompressed_gzip(),
        );

    router
        .route(
            "/config.js",
            get(move || {
                let body = config_js.clone();
                async move {
                    (
                        [
                            (
                                header::CONTENT_TYPE,
                                "application/javascript; charset=utf-8",
                            ),
                            (header::CACHE_CONTROL, "no-cache"),
                        ],
                        body,
                    )
                }
            }),
        )
        .fallback(move |request: Request| {
            let files = files.clone();
            async move { serve_static(files, request).await }
        })
}

async fn serve_static(files: ServeDir<ServeFile>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    if path == "/api" || path.starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Not found" })),
        )
            .into_response();
    }

    let mut response = match files.oneshot(request).await {
        Ok(response) => response.map(Body::new),
        Err(infallible) => match infallible {},
    };

    // Vite fingerprints everything under /assets/, so those can be cached forever.
    // Everything else (index.html, favicon, SPA routes) must be revalidated so a
    // new build is picked up immediately.
    let cache = if path.starts_with("/assets/") && response.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    response
}
