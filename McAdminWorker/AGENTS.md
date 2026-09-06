# mc_admin_worker

Rust/Axum service for managing multi-instance Minecraft servers with isolated runtimes, automated port allocation, Clerk authentication, and hardware resource controls.

## Runtime & Environment

- Loads environment variables at startup via `dotenvy`.
- Required environment variables:
  - `ADMIN_WORKER_HOST`: IP/host interface to bind (e.g. `0.0.0.0` or `127.0.0.1`).
  - `ADMIN_WORKER_PORT`: HTTP port to listen on (e.g. `8000`).
  - `HOME_DIR`: Root working directory where instance folders and configs are stored.
  - `RCON_HOST`: IP/host for RCON connections (e.g. `127.0.0.1`).
  - `CLERK_SECRET_KEY`: Clerk secret key for JWT verification and user role queries.
- Binds HTTP server on `${ADMIN_WORKER_HOST}:${ADMIN_WORKER_PORT}`.
- Global master configuration is stored in `${HOME_DIR}/mc_config.json`.
- Server instances reside in `${HOME_DIR}/instances/<instance_id>/`.

## CORS Policy

- Configured via `tower_http::cors::CorsLayer`:
  - `allow_origin`: `AllowOrigin::mirror_request()` (dynamically echoes the incoming `Origin` to satisfy credentials on any domain, IP, Tailscale node, or LAN address).
  - `allow_headers`: `AllowHeaders::mirror_request()`.
  - `allow_credentials`: `true`.
  - `allow_methods`: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`.

## Authentication & Permissions

- `ClerkAuthLayer` middleware validates incoming requests:
  - `OPTIONS` preflight requests and `GET /` (health check) are public and bypass authentication.
  - All other routes require authentication via `Authorization: Bearer <token>` or `__session` cookie.
  - JWT tokens are cryptographically verified using Clerk's JWKS public keys (`clerk_rs::validators::jwks::JwksProvider`).
  - Upon token validation, the user's role is queried from Clerk Backend API (`GET /users/{user_id}`) and cached in-memory for 60 minutes.
- Roles and Instance Permissions:
  - `superadmin`: Role in Clerk `public_metadata.role == "superadmin"` or `"owner"`. Has access to all instances and operations.
  - `owner` (`owner_id`): Creator/owner of the instance. Can delete instances, manage admins, edit configs, and control runtime.
  - `admin` (`admins` list): Assigned instance admin. Can manage server lifecycle (start/stop), execute commands, edit properties/files, and update RAM / version configuration.

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

### Health Check
- `GET /`: Health check endpoint. Returns `OK`. **Public (no auth).**

### Instance Management
- `GET /api/instances`: Lists all instances with real-time status summary, player counts, ports, RAM, and version.
- `POST /api/instances`: Creates a new instance. Accepts multipart form data:
  - `name`: Server display name (required).
  - `file`: Minecraft server `.jar` binary (required).
  - `ram_gb`: RAM allocation in GB (default: `2`).
  - `minecraft_version` (or `version`): Minecraft version string (trimmed on save).
  - `server_port`: Optional preferred Minecraft game port.
  - `rcon_port`: Optional preferred RCON port.
  - Payload limit: up to 1 GB.
- `GET /api/instances/{id}`: Returns full `InstanceConfig` details.
- `PATCH /api/instances/{id}` and `POST /api/instances/{id}`: Updates instance settings:
  - Body: `{ "ram_gb"?: number, "minecraft_version"?: string, "name"?: string }`.
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
