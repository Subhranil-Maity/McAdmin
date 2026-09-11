# mc_admin_worker

Rust/Axum service for managing multi-instance Minecraft servers with isolated runtimes, automated port allocation, in-house JWT authentication, separate role storage, Java runtime management, and hardware resource controls.

## Runtime & Environment

- Loads environment variables at startup via `dotenvy`.
- Required environment variables:
  - `ADMIN_WORKER_HOST`: IP/host interface to bind (e.g. `0.0.0.0` or `127.0.0.1`).
  - `ADMIN_WORKER_PORT`: HTTP port to listen on (e.g. `8000`).
  - `HOME_DIR`: Root working directory where instance folders and configs are stored.
  - `RCON_HOST`: IP/host for RCON connections (e.g. `127.0.0.1`).
  - `JWT_SECRET`: Optional HMAC-SHA256 JWT signing key (defaults to internal fallback if unset).
- Binds HTTP server on `${ADMIN_WORKER_HOST}:${ADMIN_WORKER_PORT}`.
- Global master configuration is stored in `${HOME_DIR}/mc_config.json`.
- Global user store is stored in `${HOME_DIR}/users.json`.
- Instance-specific access roles are stored in `${HOME_DIR}/roles.json`.
- Java runtimes and executable paths are stored in `${HOME_DIR}/java_runtimes.json`.
- Server instances reside in `${HOME_DIR}/instances/<instance_id>/`.

## CORS Policy

- Configured via `tower_http::cors::CorsLayer`:
  - `allow_origin`: `AllowOrigin::mirror_request()` (dynamically echoes the incoming `Origin` to satisfy credentials on any domain, IP, Tailscale node, or LAN address).
  - `allow_headers`: `AllowHeaders::mirror_request()`.
  - `allow_credentials`: `true`.
  - `allow_methods`: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`.

## Authentication & Authorization (In-House)

- `JwtAuthLayer` middleware validates incoming requests:
  - `OPTIONS` preflight requests, `GET /`, `GET /api/auth/health`, `POST /api/auth/register`, and `POST /api/auth/login` are public and bypass authentication.
  - All other routes require authentication via `Authorization: Bearer <token>` or `mcadmin_token` cookie.
  - Passwords are securely hashed with Argon2id.
  - The first registered user is automatically bootstrapped with `is_superuser = true`.
- Global Roles & Permissions (`users.json`):
  - `is_superuser: bool`: Omnipotent access across all instances and user administration (`/api/users`).
  - `permissions: { can_create_server: bool }`: Controls server creation rights.
- Instance-Specific Roles (`roles.json`):
  - Completely decoupled from `users.json`. Stored per instance (`owner_id`, `admins: []`, `users: []`).
  - `owner`: Can delete instances, manage admins, transfer ownership, and update configurations.
  - `admin`: Can start/stop servers, send commands, edit files/properties, and adjust RAM/version/Java.
  - `user`: Can view instance status, players, and console logs.

## Java Runtime Management (`java_runtimes.json`)

Managed by `JavaManager`:
- Stored in `${HOME_DIR}/java_runtimes.json`.
- If the file is missing or empty, the backend scans `/usr/lib/jvm`, `/opt/java`, `/usr/java`, and `PATH`, probes versions with `-version`, and generates the initial config.
- Users can manually add, edit, or remove custom JVM paths in `java_runtimes.json` anytime.
- Each Minecraft instance config can set `java_runtime` (referencing an ID or custom binary path).
- When starting an instance, `InstanceManager` resolves `java_runtime` to the target executable, falling back to the default configured runtime or `PATH` `java`.

## Master Config (`mc_config.json`)

Managed by `McConfigManager`:
```json
{
  "version": 1,
  "instances": [
    {
      "id": "uuid-v4",
      "name": "Survival Server",
      "folder": "instances/uuid-v4",
      "jar_name": "server.jar",
      "server_port": 25565,
      "rcon_port": 25575,
      "rcon_password": "rcon_secret_password",
      "ram_gb": 4,
      "minecraft_version": "1.20.4",
      "created_at": "2026-09-06T12:00:00Z",
      "owner_id": "user_2...",
      "admins": ["user_3..."]
    }
  ]
}
```

- Automatic port collision detection and allocation for `server_port` (starts at 25565) and `rcon_port` (starts at 25575).
- `ram_gb`: Java heap allocation (`-Xms<N>G -Xmx<N>G`).
- `minecraft_version`: Stored as a trimmed string.

## HTTP API Endpoints

### Health Check & Auth
- `GET /`: Health check endpoint. Returns `OK`. **Public (no auth).**
- `GET /api/auth/health`: In-house auth system status. **Public (no auth).**
- `POST /api/auth/register`: Register user account. First account gets superuser. **Public (no auth).**
- `POST /api/auth/login`: Authenticate and return JWT token and user info. **Public (no auth).**
- `GET /api/auth/me`: Current authenticated user session details.

### Java Runtime Management
- `GET /api/java-runtimes`: Lists configured Java runtimes with detection status and validation.
- `POST /api/java-runtimes/scan`: Triggers host system scan to discover JVMs and merges into `java_runtimes.json` (superuser only).
- `POST /api/java-runtimes`: Adds or updates a custom Java runtime (superuser only).
- `DELETE /api/java-runtimes/{id}`: Deletes a configured Java runtime (superuser only).

### User Management
- `GET /api/users`: List users. Superusers see full list and permissions; others see sanitized username directory.
- `PATCH /api/users/{id}`: Update permissions, toggle `is_superuser`, or reset password (superuser only).
- `DELETE /api/users/{id}`: Delete user account (superuser only; cannot delete last superuser).

### Instance Management
- `GET /api/instances`: Lists all instances with real-time status summary, player counts, ports, RAM, version, and Java runtime.
- `POST /api/instances`: Creates a new instance. Accepts multipart form data:
  - `name`: Server display name (required).
  - `file`: Minecraft server `.jar` binary (required).
  - `ram_gb`: RAM allocation in GB (default: `2`).
  - `minecraft_version` (or `version`): Minecraft version string (trimmed on save).
  - `java_runtime` (or `java`): Optional Java runtime ID or custom binary path.
  - `server_port`: Optional preferred Minecraft game port.
  - `rcon_port`: Optional preferred RCON port.
  - Payload limit: up to 1 GB.
- `GET /api/instances/{id}`: Returns full `InstanceConfig` details.
- `PATCH /api/instances/{id}` and `POST /api/instances/{id}`: Updates instance settings:
  - Body: `{ "ram_gb"?: number, "minecraft_version"?: string, "name"?: string, "java_runtime"?: string }`.
  - String values are automatically trimmed before persisting to config and memory runtime.
- `DELETE /api/instances/{id}`: Deletes the instance, stops runtime if running, and recursively deletes its folder.

### Server Lifecycle & Telemetry
- `GET /api/instances/{id}/status`: Returns live status (`ONLINE`, `OFFLINE`, `STARTING`), CPU %, RAM allocated vs used, uptime in seconds, active/max players, version, and the 250 most recent console log lines.
- `POST /api/instances/{id}/start`: Launches `java -jar <jar_name> nogui -Xms<ram_gb>G -Xmx<ram_gb>G` in the instance directory.
- `POST /api/instances/{id}/stop`: Gracefully stops the instance via RCON or terminates process.
- `POST /api/instances/{id}/command`: Sends an RCON command. Body: `{ "command": "say Hello" }`.

### Admins & Permissions
- `POST /api/instances/{id}/admins`: Updates instance admin list. Body: `{ "admins": ["user_1", "user_2"] }`. Restricted to instance owner or superadmin.

### Server Properties
- `GET /api/instances/{id}/properties`: Reads `server.properties` and returns key/value JSON map.
- `POST /api/instances/{id}/properties`: Writes full key/value map to `server.properties`.

### Players Management
- `GET /api/instances/{id}/players`: Enriched player list from `usercache.json`, `ops.json`, `whitelist.json`, `banned-players.json`.
- `GET /api/instances/{id}/players/online`: Current online usernames from live RCON `list`.
- `POST /api/instances/{id}/players/{action}`: Player actions (`ban`, `unban`, `whitelist`, `dewhitelist`, `op`, `deop`, `kick`). Body: `{ "player": "name", "reason?": "..." }`.

### Files Management
- `GET /api/instances/{id}/files?path=<rel_path>`: Lists directory entries inside instance folder.
- `GET /api/instances/{id}/files/content?path=<rel_path>`: Reads text file content (up to 5 MB).
- `POST /api/instances/{id}/files/write`: Writes content to file. Body: `{ "path": "...", "content": "...", "force": false }`.
- `POST /api/instances/{id}/files/upload`: Multipart file upload into instance folder (up to 1 GB).

## Logging & RCON

- Each running instance has an isolated 15,000-line circular log ring buffer capturing stdout/stderr.
- Commands and queries use an isolated Tokio RCON client connecting to the instance's unique RCON port and password.

## Development & Verification

- Formatter: `cargo fmt`
- Typecheck & validation: `cargo check`
- Test suite: `cargo test`
- Release build: `cargo build --release`
