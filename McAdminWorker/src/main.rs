use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, Method, request::Parts},
    routing::get,
};
use serde::Serialize;
use std::env;
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    system: Arc<Mutex<System>>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ServerStatusResponse {
    pub status: String,
    pub cpu_usage: f32,
    pub ram_allocated_mb: u64,
    pub ram_used_mb: u64,
    pub uptime_seconds: u64,
    pub active_players: u32,
    pub max_players: u32,
    pub recent_logs: Vec<String>,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().expect(".env file is required at runtime");

    let host = env::var("ADMIN_WORKER_HOST").expect("ADMIN_WORKER_HOST must be set");
    let port = env::var("ADMIN_WORKER_PORT")
        .expect("ADMIN_WORKER_PORT must be set")
        .parse::<u16>()
        .expect("ADMIN_WORKER_PORT must be a valid u16 port");
    let bind_addr = format!("{host}:{port}");

    let state = AppState {
        system: Arc::new(Mutex::new(System::new_all())),
    };

    let app = Router::new()
        .route("/", get(health))
        .route("/api/status", get(server_status))
        .layer(cors_layer())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind TCP listener");

    axum::serve(listener, app)
        .await
        .expect("failed to start Axum server");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "mc_admin_worker",
    })
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _request_parts: &Parts| is_local_origin(origin),
        ))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any)
}

fn is_local_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    [
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
        "https://127.0.0.1",
    ]
    .iter()
    .any(|allowed_origin| {
        origin == *allowed_origin || origin.starts_with(&format!("{allowed_origin}:"))
    })
}

async fn server_status(State(state): State<AppState>) -> Json<ServerStatusResponse> {
    let mut system = state.system.lock().await;
    system.refresh_memory();
    system.refresh_cpu_usage();

    Json(ServerStatusResponse {
        status: "ONLINE".to_string(),
        cpu_usage: system.global_cpu_usage(),
        ram_allocated_mb: system.total_memory() / 1024 / 1024,
        ram_used_mb: system.used_memory() / 1024 / 1024,
        uptime_seconds: System::uptime(),
        active_players: 0,
        max_players: 10,
        recent_logs: Vec::new(),
    })
}
