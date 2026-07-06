mod config;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderValue, Method, StatusCode, request::Parts},
    routing::{get, post},
};
use config::{ConfigEntry, ConfigManager};
use serde::Serialize;
use std::env;
use std::io;
use std::path::{Path as FsPath, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex;
use tokio::time::{Duration, sleep};
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::{Level, error, info};

#[derive(Clone)]
struct AppState {
    system: Arc<Mutex<System>>,
    config: Arc<ConfigManager>,
    minecraft: Arc<Mutex<MinecraftServerRuntime>>,
    server_dir: Arc<PathBuf>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MinecraftServerState {
    Offline,
    Starting,
    Online,
}

impl MinecraftServerState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Offline => "OFFLINE",
            Self::Starting => "STARTING",
            Self::Online => "ONLINE",
        }
    }
}

#[derive(Debug)]
struct MinecraftServerRuntime {
    state: MinecraftServerState,
    process_id: Option<u32>,
    child: Option<Child>,
}

#[derive(Debug, Serialize)]
struct StartServerResponse {
    status: &'static str,
    ram_gb: u32,
    process_id: Option<u32>,
}

#[derive(Debug, Serialize)]
struct StopServerResponse {
    status: &'static str,
    process_id: Option<u32>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).init();
    dotenvy::dotenv().expect(".env file is required at runtime");

    let host = env::var("ADMIN_WORKER_HOST").expect("ADMIN_WORKER_HOST must be set");
    let port = env::var("ADMIN_WORKER_PORT")
        .expect("ADMIN_WORKER_PORT must be set")
        .parse::<u16>()
        .expect("ADMIN_WORKER_PORT must be a valid u16 port");
    let bind_addr = format!("{host}:{port}");
    let home_dir = env::var("HOME_DIR").expect("HOME_DIR must be set");
    let server_dir = Arc::new(PathBuf::from(home_dir));
    let config_path = server_dir.join("admin_worker_config.json");

    let state = AppState {
        system: Arc::new(Mutex::new(System::new_all())),
        config: Arc::new(
            ConfigManager::load(config_path)
                .await
                .expect("failed to load config manager"),
        ),
        minecraft: Arc::new(Mutex::new(MinecraftServerRuntime {
            state: MinecraftServerState::Offline,
            process_id: None,
            child: None,
        })),
        server_dir,
    };

    info!("loaded runtime configuration");

    let app = Router::new()
        .route("/", get(health))
        .route("/api/status", get(server_status))
        .route("/api/server/start", post(start_server))
        .route("/api/server/stop", post(stop_server))
        .route("/api/config", get(list_config))
        .route("/api/config/{key}", get(get_config))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(cors_layer())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind TCP listener");

    info!("listening on {}", bind_addr);

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
    let server_status = state.minecraft.lock().await.state.as_str().to_string();

    Json(ServerStatusResponse {
        status: server_status,
        cpu_usage: system.global_cpu_usage(),
        ram_allocated_mb: system.total_memory() / 1024 / 1024,
        ram_used_mb: system.used_memory() / 1024 / 1024,
        uptime_seconds: System::uptime(),
        active_players: 0,
        max_players: 10,
        recent_logs: Vec::new(),
    })
}

async fn start_server(
    State(state): State<AppState>,
) -> Result<Json<StartServerResponse>, StatusCode> {
    info!("start server requested");

    if !state.server_dir.exists() {
        error!("server directory missing: {}", state.server_dir.display());
        return Err(StatusCode::NOT_FOUND);
    }

    let ram_gb = state.config.get_server_ram().await;
    let jar_path = Arc::new(resolve_jar_path(state.config.get_jar_path().await));
    if !jar_path.exists() {
        error!("jar file missing: {}", jar_path.display());
        return Err(StatusCode::NOT_FOUND);
    }

    info!(
        "start server requested: jar_path={}, server_dir={}, ram_gb={}",
        jar_path.display(),
        state.server_dir.display(),
        ram_gb
    );

    let process_id = {
        let mut minecraft = state.minecraft.lock().await;
        if minecraft.state != MinecraftServerState::Offline {
            return Err(StatusCode::CONFLICT);
        }

        minecraft.state = MinecraftServerState::Starting;
        minecraft.process_id = None;
        minecraft.child = None;

        if let Err(error) =
            start_minecraft_server(&jar_path, &state.server_dir, ram_gb, &mut minecraft)
        {
            error!("Minecraft server failed: {error}");
            minecraft.state = MinecraftServerState::Offline;
            minecraft.process_id = None;
            minecraft.child = None;
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }

        minecraft.process_id
    };

    tokio::spawn(monitor_minecraft_server(state.minecraft.clone()));

    Ok(Json(StartServerResponse {
        status: MinecraftServerState::Online.as_str(),
        ram_gb,
        process_id,
    }))
}

async fn monitor_minecraft_server(minecraft: Arc<Mutex<MinecraftServerRuntime>>) {
    loop {
        sleep(Duration::from_secs(1)).await;

        let exit_status = {
            let mut runtime = minecraft.lock().await;
            let Some(child) = runtime.child.as_mut() else {
                return;
            };

            match child.try_wait() {
                Ok(Some(status)) => Some(Ok(status)),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            }
        };

        match exit_status {
            Some(Ok(status)) => {
                info!(
                    "Minecraft server stopped with exit code: {:?}",
                    status.code()
                );
                reset_minecraft_runtime(&minecraft).await;
                return;
            }
            Some(Err(error)) => {
                error!("Minecraft server status check failed: {error}");
                reset_minecraft_runtime(&minecraft).await;
                return;
            }
            None => {}
        }
    }
}

async fn list_config(State(state): State<AppState>) -> Json<Vec<ConfigEntry>> {
    Json(state.config.list().await)
}

async fn get_config(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<ConfigEntry>, StatusCode> {
    let value = state.config.get(&key).await.ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(ConfigEntry { key, value }))
}

fn resolve_jar_path(jar_path: PathBuf) -> PathBuf {
    if jar_path.is_absolute() {
        jar_path
    } else {
        env::current_dir()
            .expect("failed to read current working directory")
            .join(jar_path)
    }
}

async fn stop_server(
    State(state): State<AppState>,
) -> Result<Json<StopServerResponse>, StatusCode> {
    info!("stop server requested");

    let mut child = {
        let mut minecraft = state.minecraft.lock().await;
        if minecraft.state == MinecraftServerState::Offline {
            error!("stop server requested while server is offline");
            return Err(StatusCode::CONFLICT);
        }

        minecraft.state = MinecraftServerState::Offline;
        minecraft.process_id = None;
        minecraft.child.take()
    };

    if let Some(child) = child.as_mut() {
        child
            .kill()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let _ = child.wait();
    }

    Ok(Json(StopServerResponse {
        status: MinecraftServerState::Offline.as_str(),
        process_id: None,
    }))
}

fn start_minecraft_server(
    jar_path: &FsPath,
    server_dir: &FsPath,
    ram_gb: u32,
    minecraft: &mut MinecraftServerRuntime,
) -> io::Result<()> {
    if !jar_path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Jar file not found",
        ));
    }
    if !server_dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Server directory not found",
        ));
    }

    let xms = format!("-Xms{}G", ram_gb);
    let xmx = format!("-Xmx{}G", ram_gb);

    info!("Starting Minecraft server inside: {}", server_dir.display());

    let child = Command::new("java")
        .current_dir(server_dir)
        .arg(&xms)
        .arg(&xmx)
        .arg("-jar")
        .arg(jar_path)
        .arg("--nogui")
        .arg("--noconsole")
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;
    let process_id = child.id();

    minecraft.state = MinecraftServerState::Online;
    minecraft.process_id = Some(process_id);
    minecraft.child = Some(child);

    Ok(())
}

async fn reset_minecraft_runtime(minecraft: &Arc<Mutex<MinecraftServerRuntime>>) {
    let mut runtime = minecraft.lock().await;
    runtime.state = MinecraftServerState::Offline;
    runtime.process_id = None;
    runtime.child = None;
}
