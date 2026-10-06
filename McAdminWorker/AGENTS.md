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
      "server_type": "fabric",
      "loader_version": "0.16.5",
      "installed_jar_version": "1.20.4|0.16.5",
      "created_at": "2026-09-06T12:00:00Z",
      "owner_id": "user_2...",
      "admins": ["user_3..."]
    }
  ]
}
```

- Automatic port collision detection and allocation for `server_port` (starts at 25565) and `rcon_port` (starts at 25575).
- `ram_gb`: Java heap allocation (`-Xms<N>G -Xmx<N>G`).
- `minecraft_version`: Stored as a trimmed string. Any value is allowed; values not in Mojang's official list are reported as `version_status: "unknown"`.
- `server_type`: `vanilla` | `fabric` | `custom` (default `custom`, so configs written before this field existed keep using their uploaded jar).
- `loader_version`: Fabric loader version (Fabric only).
- `installed_jar_version`: `<mc>|<loader>` the managed jar was downloaded for; when it differs from the configured version the jar is re-downloaded on the next start.

## Managed Server Jars & Version Catalogue

- `VersionCatalog` (`src/mc_versions.rs`) loads Mojang's `version_manifest_v2.json`, caches it in memory for 1h and on disk at `${HOME_DIR}/cache/version_manifest.json`. Fallback chain: live -> disk cache -> none. It never fails; a version missing from a stale list triggers one forced refresh (30s backoff).
- Vanilla instances use `server.jar` (official jar, sha1-verified). Fabric instances run `fabric-server-launch.jar` (from `meta.fabricmc.net`) with the official `server.jar` pre-downloaded next to it.
- Jars are downloaded on start (`StartOutcome::Preparing`, HTTP 202) with progress in the console. If the version is unknown and a jar already exists, it is used as-is with a warning; otherwise the start fails with a console error.
- All downloads go through `src/http_download.rs` (shared client, temp file + rename, sha1/sha256/sha512 verification).

## Modrinth, Content & Jobs

- `ModrinthClient` (`src/modrinth.rs`, base URL overridable with env `MODRINTH_API_URL`): a shared rate limiter (300 req/min, synced from `X-Ratelimit-*` headers; waits for the reset and retries 429 up to 3 times, reporting each wait), a 5-minute response cache, and batched hash/project endpoints. Network errors and 5xx map to HTTP 502 `{"error":"modrinth_unreachable"}`.
- Installed content (`src/content.rs`): `mods/*.jar`, `<level-name>/datapacks/*`, and the `resource-pack` property. Metadata cache in `<instance>/.mcadmin/content.json` (project, version, hashes, update info) plus icons in `.mcadmin/icons/`. Listing never calls Modrinth, so it works offline.
- Identify matches jars and datapack zips by sha1 (`POST /version_files`), stores the metadata, and records the latest compatible versions (`POST /version_files/update`). Files with no match get `manual` metadata read from `fabric.mod.json`.
- Modpacks (`src/modpack.rs`): Fabric-only `.mrpack` files. Server-side files are downloaded from the spec's allowed hosts (sha512 verified), then `overrides/` and `server-overrides/` are extracted. Installed paths go to `.mcadmin/modpack.json` and are removed on reinstall/upgrade. `server-port`/RCON keys in `server.properties` are preserved. The instance is in state `INSTALLING` throughout.
- Jobs (`src/jobs.rs`): one content-writing job per instance (otherwise 409). Progress is pushed over the instance WebSocket as `{"type":"job","data":{...}}` and is available at `GET /api/jobs/{id}`. Finished jobs are kept for 10 minutes.

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

### Minecraft Versions
- `GET /api/minecraft/versions?include_snapshots=&refresh=`: Official versions plus `source` (`live`|`cache`). Returns 503 `version_list_unavailable` if no list exists.
- `GET /api/minecraft/fabric/games?include_snapshots=`, `GET /api/minecraft/fabric/loaders?game=`: Fabric meta (502 `fabric_unreachable` when offline).

### Modrinth Proxy & Jobs
- `GET /api/modrinth/search?query&project_type=mod|datapack|resourcepack|modpack&game_version&loader&offset&limit&index`
- `GET /api/modrinth/project/{id}`, `GET /api/modrinth/project/{id}/versions?game_version&loader`
- `GET /api/jobs/{id}`: Job progress (`state`, `done`, `total`, `message`, `waiting_secs`).

### Instance Content (Mods, Datapacks, Resource Pack, Modpacks)
- `GET /api/instances/{id}/content`: Installed content merged with cached metadata (`files:read`). Works offline.
- `DELETE /api/instances/{id}/content`: Body `{ "kind": "mod"|"datapack"|"resourcepack", "filename": "..." }` (`files:delete`).
- `POST /api/instances/{id}/content/install`: Body `{ "version_id", "kind" }`. Resolves required dependencies for mods (Fabric only). Returns 202 `{ job_id }` (`files:upload`).
- `POST /api/instances/{id}/content/identify`: Body `{ "force"?: bool }`. Returns 202 `{ job_id }` (`files:upload`).
- `GET /api/instances/{id}/content/icon/{project_id}`: Locally cached project icon.
- `POST /api/instances/{id}/modpack`: Body `{ "version_id" }`. Fabric instances only, and the server must be offline (`files:upload`).
- `POST /api/instances/modpack`: Creates a Fabric instance from a modpack: `{ name, version_id, ram_gb?, java_runtime?, server_port?, rcon_port? }`. Returns 201 with the instance plus `job_id`.
- `GET /api/instances/{id}/jobs`: Running and recent jobs for the instance.

### Instance Management
- `GET /api/instances`: Lists all instances with real-time status summary, player counts, ports, RAM, version, Java runtime, `server_type`, `loader_version` and `version_status`.
- `POST /api/instances`: Creates a new instance. Accepts multipart form data:
  - `name`: Server display name (required).
  - `server_type`: `vanilla` | `fabric` | `custom` (default `custom`). Vanilla/Fabric require an official `minecraft_version` (400 otherwise; 503 `version_list_unavailable` when no list can be loaded) and download their jar on first start.
  - `loader_version`: Optional Fabric loader (defaults to the latest stable).
  - `file`: Minecraft server `.jar` binary (required for `custom` only).
  - `ram_gb`: RAM allocation in GB (default: `2`).
  - `minecraft_version` (or `version`): Minecraft version string (trimmed on save).
  - `java_runtime` (or `java`): Optional Java runtime ID or custom binary path.
  - `server_port`: Optional preferred Minecraft game port.
  - `rcon_port`: Optional preferred RCON port.
  - Payload limit: up to 1 GB.
- `GET /api/instances/{id}`: Returns full `InstanceConfig` details.
- `PATCH /api/instances/{id}` and `POST /api/instances/{id}`: Updates instance settings:
  - Body: `{ "ram_gb"?: number, "minecraft_version"?: string, "name"?: string, "java_runtime"?: string, "loader_version"?: string }`. Changing the version or loader of a Vanilla/Fabric instance re-downloads its jar on the next start.
  - String values are automatically trimmed before persisting to config and memory runtime.
- `DELETE /api/instances/{id}`: Deletes the instance, stops runtime if running, and recursively deletes its folder.

### Server Lifecycle & Telemetry
- `GET /api/instances/{id}/status`: Returns live status (`ONLINE`, `OFFLINE`, `STARTING`, `STOPPING`, `INSTALLING`), CPU %, RAM allocated vs used, uptime in seconds, active/max players, version, and the 250 most recent console log lines.
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
