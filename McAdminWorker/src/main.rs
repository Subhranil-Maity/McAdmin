mod api;
mod auth;
mod instance_config;
mod instance_manager;
mod instance_runtime;
mod minecraft_files;

use api::health;
use api::instances::{
    command_instance, create_instance, delete_instance, get_instance, get_instance_file_content,
    get_instance_online_players, get_instance_players, get_instance_properties, get_instance_status,
    instance_player_action, list_instance_files, list_instances, start_instance, stop_instance,
    update_instance, update_instance_admins, update_instance_properties, upload_instance_file,
    write_instance_file,
};
use auth::ClerkAuthLayer;
use axum::{
    Router,
    http::Method,
    routing::{get, patch, post},
};
use instance_config::McConfigManager;
use instance_manager::InstanceManager;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex as TokioMutex;
use tower_http::{
    cors::{AllowHeaders, AllowOrigin, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::{Level, info};

#[derive(Clone)]
pub struct AppState {
    pub system: Arc<TokioMutex<System>>,
    pub config_manager: Arc<McConfigManager>,
    pub instance_manager: Arc<InstanceManager>,
    pub home_dir: Arc<PathBuf>,
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

    let home_dir_str = env::var("HOME_DIR").expect("HOME_DIR must be set");
    let home_dir = Arc::new(PathBuf::from(home_dir_str));
    let config_path = home_dir.join("mc_config.json");

    let rcon_host = env::var("RCON_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let clerk_secret_key = env::var("CLERK_SECRET_KEY").expect("CLERK_SECRET_KEY must be set");

    let config_manager = Arc::new(
        McConfigManager::load(config_path)
            .await
            .expect("Failed to load McConfigManager"),
    );

    let instance_manager = Arc::new(
        InstanceManager::new(
            (*home_dir).clone(),
            rcon_host,
            config_manager.clone(),
        )
        .await,
    );

    let state = AppState {
        system: Arc::new(TokioMutex::new(System::new_all())),
        config_manager,
        instance_manager,
        home_dir,
    };

    info!("Loaded multi-instance runtime configuration");

    let app = Router::new()
        .route("/", get(health))
        .route("/api/instances", get(list_instances))
        .route(
            "/api/instances",
            post(create_instance).layer(axum::extract::DefaultBodyLimit::max(1024 * 1024 * 1024)),
        )
        .route(
            "/api/instances/{id}",
            get(get_instance)
                .patch(update_instance)
                .post(update_instance)
                .delete(delete_instance),
        )
        .route(
            "/api/instances/{id}/config",
            patch(update_instance).post(update_instance),
        )
        .route("/api/instances/{id}/status", get(get_instance_status))
        .route("/api/instances/{id}/start", post(start_instance))
        .route("/api/instances/{id}/stop", post(stop_instance))
        .route("/api/instances/{id}/command", post(command_instance))
        .route("/api/instances/{id}/admins", post(update_instance_admins))
        .route(
            "/api/instances/{id}/properties",
            get(get_instance_properties).post(update_instance_properties),
        )
        .route("/api/instances/{id}/players", get(get_instance_players))
        .route(
            "/api/instances/{id}/players/online",
            get(get_instance_online_players),
        )
        .route(
            "/api/instances/{id}/players/{action}",
            post(instance_player_action),
        )
        .route("/api/instances/{id}/files", get(list_instance_files))
        .route(
            "/api/instances/{id}/files/content",
            get(get_instance_file_content),
        )
        .route(
            "/api/instances/{id}/files/write",
            post(write_instance_file),
        )
        .route(
            "/api/instances/{id}/files/upload",
            post(upload_instance_file).layer(axum::extract::DefaultBodyLimit::max(1024 * 1024 * 1024)),
        )
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(ClerkAuthLayer::new(clerk_secret_key))
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

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::DELETE,
            Method::PUT,
            Method::PATCH,
            Method::OPTIONS,
        ])
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true)
}
