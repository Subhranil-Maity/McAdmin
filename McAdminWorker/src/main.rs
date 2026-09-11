mod api;
mod auth;
mod instance_config;
mod instance_manager;
mod instance_runtime;
mod java_manager;
mod minecraft_files;
mod role_manager;
mod user_manager;

use api::auth::{auth_health, login, me, register};
use api::health;
use api::instances::{
    add_instance_member, command_instance, create_instance, delete_instance, delete_instance_file,
    get_instance, get_instance_file_content, get_instance_members, get_instance_online_players,
    get_instance_players, get_instance_properties, get_instance_status, get_my_instance_permissions,
    instance_player_action, instance_ws_handler, list_instance_files, list_instances,
    remove_instance_member, restart_instance, start_instance, stop_instance, transfer_instance_ownership,
    update_instance, update_instance_admins, update_instance_properties, upload_instance_file,
    write_instance_file,
};
use api::java_runtimes::{
    add_or_update_java_runtime, delete_java_runtime, list_java_runtimes, scan_java_runtimes,
};
use api::users::{delete_user, list_users, update_user};
use auth::JwtAuthLayer;
use axum::{
    http::Method,
    routing::{delete, get, patch, post},
    Router,
};
use instance_config::McConfigManager;
use instance_manager::InstanceManager;
use java_manager::JavaManager;
use role_manager::RoleManager;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex as TokioMutex;
use tower_http::{
    cors::{AllowHeaders, AllowOrigin, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::{info, Level};
use user_manager::UserManager;

#[derive(Clone)]
pub struct AppState {
    pub system: Arc<TokioMutex<System>>,
    pub config_manager: Arc<McConfigManager>,
    pub instance_manager: Arc<InstanceManager>,
    pub user_manager: Arc<UserManager>,
    pub role_manager: Arc<RoleManager>,
    pub java_manager: Arc<JavaManager>,
    pub jwt_secret: Arc<String>,
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
    let users_path = home_dir.join("users.json");
    let roles_path = home_dir.join("roles.json");

    let rcon_host = env::var("RCON_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| auth::DEFAULT_JWT_SECRET.to_string());

    let config_manager = Arc::new(
        McConfigManager::load(config_path)
            .await
            .expect("Failed to load McConfigManager"),
    );

    let user_manager = Arc::new(
        UserManager::load(users_path)
            .await
            .expect("Failed to load UserManager"),
    );

    let role_manager = Arc::new(
        RoleManager::load(roles_path)
            .await
            .expect("Failed to load RoleManager"),
    );

    // Sync any existing instances into the roles store
    let existing_instances = config_manager.list_instances().await;
    role_manager
        .sync_instances(&existing_instances)
        .await
        .expect("Failed to sync instance roles");

    let java_runtimes_path = home_dir.join("java_runtimes.json");
    let java_manager = Arc::new(
        JavaManager::load(java_runtimes_path)
            .await
            .expect("Failed to load JavaManager"),
    );

    let instance_manager = Arc::new(
        InstanceManager::new(
            (*home_dir).clone(),
            rcon_host,
            config_manager.clone(),
            java_manager.clone(),
        )
        .await,
    );

    let state = AppState {
        system: Arc::new(TokioMutex::new(System::new_all())),
        config_manager,
        instance_manager,
        user_manager: user_manager.clone(),
        role_manager,
        java_manager,
        jwt_secret: Arc::new(jwt_secret.clone()),
        home_dir,
    };

    info!("Loaded multi-instance runtime and in-house auth configuration");

    let app = Router::new()
        // Public / Health routes
        .route("/", get(health))
        .route("/api/auth/health", get(auth_health))
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/me", get(me))
        // User management
        .route("/api/users", get(list_users))
        .route("/api/users/{id}", patch(update_user).delete(delete_user))
        // Java runtime management
        .route(
            "/api/java-runtimes",
            get(list_java_runtimes).post(add_or_update_java_runtime),
        )
        .route("/api/java-runtimes/scan", post(scan_java_runtimes))
        .route("/api/java-runtimes/{id}", delete(delete_java_runtime))
        // Instances
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
        .route("/api/instances/{id}/ws", get(instance_ws_handler))
        .route("/api/instances/{id}/start", post(start_instance))
        .route("/api/instances/{id}/stop", post(stop_instance))
        .route("/api/instances/{id}/restart", post(restart_instance))
        .route("/api/instances/{id}/command", post(command_instance))
        // Instance members & roles
        .route("/api/instances/{id}/members", get(get_instance_members).post(add_instance_member))
        .route("/api/instances/{id}/members/{user_id}", delete(remove_instance_member))
        .route("/api/instances/{id}/my-permissions", get(get_my_instance_permissions))
        .route("/api/instances/{id}/transfer-ownership", post(transfer_instance_ownership))
        .route("/api/instances/{id}/admins", post(update_instance_admins))
        // Instance properties & players
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
        // Instance files
        .route("/api/instances/{id}/files", get(list_instance_files).delete(delete_instance_file))
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
        .layer(JwtAuthLayer::new(jwt_secret, user_manager))
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
