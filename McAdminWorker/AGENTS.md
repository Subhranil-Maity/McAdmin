# mc_admin_worker

Rust/Axum service for managing a Minecraft server worker process.

## Runtime

- Loads `.env` at startup with `dotenvy`.
- Requires `ADMIN_WORKER_HOST`, `ADMIN_WORKER_PORT`, and `HOME_DIR`.
- Requires `RCON_HOST`, `RCON_PORT`, and `RCON_PASSWORD` for RCON command forwarding.
- Requires `CLERK_SECRET_KEY` for Clerk authentication.
- Binds the HTTP server from `ADMIN_WORKER_HOST:ADMIN_WORKER_PORT`.
- Uses `HOME_DIR` as the Minecraft server directory.
- Reads config from `HOME_DIR/admin_worker_config.json`.
- Reads and writes Minecraft server properties from `HOME_DIR/server.properties`.
- Defaults `SERVER_RAM` to `1` if missing.
- Defaults `JAR_PATH` to `./server.jar` if missing.

## Config

- Config is persisted on disk as a JSON key/value map.
- Current read-only config keys exposed by the API:
  - `SERVER_RAM`
  - `JAR_PATH`
- `SERVER_RAM` controls the Java heap size passed to the Minecraft server start command.
- `JAR_PATH` is resolved relative to the worker process current working directory when it is not absolute.

## HTTP API

- `GET /`
  - Health response for the worker. **Public (no auth).**
- `GET /api/status`
  - Returns worker/server runtime status and system metrics. **Public (no auth).**
- `POST /api/server/start`
  - Starts the Minecraft server process.
- `POST /api/server/stop`
  - Stops the running Minecraft server process.
- `POST /api/server/command`
  - Sends a command to the running Minecraft server over RCON.
- `GET /api/server/properties`
  - Returns `HOME_DIR/server.properties` as a JSON key/value map.
- `POST /api/server/properties`
  - Replaces `HOME_DIR/server.properties` with the provided full JSON key/value map and returns it.
- `GET /api/server/players`
  - Returns all known players from `usercache.json` enriched with op/whitelist/ban status from `ops.json`, `whitelist.json`, and `banned-players.json`.
- `GET /api/server/players/online`
  - Returns currently online players via RCON `list` command. Requires server to be `ONLINE`.
- `POST /api/server/players/ban`
  - Bans a player. If server is `ONLINE` uses RCON `ban`; if `OFFLINE` writes to `banned-players.json` (requires player to exist in `usercache.json`). Body: `{ "player": "name", "reason?": "..." }`.
- `POST /api/server/players/unban`
  - Unbans a player. If server is `ONLINE` uses RCON `pardon`; if `OFFLINE` removes from `banned-players.json`. Body: `{ "player": "name" }`.
- `POST /api/server/players/whitelist`
  - Whitelists a player. If server is `ONLINE` uses RCON `whitelist add`; if `OFFLINE` writes to `whitelist.json` (requires player to exist in `usercache.json`). Body: `{ "player": "name" }`.
- `POST /api/server/players/dewhitelist`
  - Dewhitelsists a player. If server is `ONLINE` uses RCON `whitelist remove`; if `OFFLINE` removes from `whitelist.json`. Body: `{ "player": "name" }`.
- `POST /api/server/players/op`
  - Ops a player (level 4). If server is `ONLINE` uses RCON `op`; if `OFFLINE` writes to `ops.json` (requires player to exist in `usercache.json`). Body: `{ "player": "name" }`.
- `POST /api/server/players/deop`
  - Deops a player. If server is `ONLINE` uses RCON `deop`; if `OFFLINE` removes from `ops.json`. Body: `{ "player": "name" }`.
- `GET /api/config`
  - Lists persisted config entries.
- `GET /api/config/{key}`
  - Reads one persisted config entry.

## Auth

- All routes except `GET /` and `GET /api/status` require Clerk authentication.
- Accepts `Authorization: Bearer <token>` header or `__session` cookie.
- JWT is verified against Clerk's JWKS (RS256).
- After JWT validation, the user is fetched from Clerk Backend API (`GET /users/{user_id}`).
- `public_metadata.role` must be `"admin"` or `"owner"` (case-insensitive).
- User roles are cached in-memory for 60 minutes to avoid repeated API calls.
- Logs: `auth OK`, `role cache hit` (with remaining TTL), `role cache miss`, `auth rejected` (with reason).

## Server lifecycle

- The runtime tracks Minecraft state in memory.
- Status values are `OFFLINE`, `STARTING`, and `ONLINE`.
- Starting the server spawns `java -jar <jar> nogui` with `-Xms` and `-Xmx` based on `SERVER_RAM`.
- Stopping the server kills the stored child process handle and clears runtime state.
- Server commands are sent with `rcon-tokio` through a shared RCON client stored in app state.
- Recent logs are captured from the Minecraft process stdout/stderr into a 15,000-line circular buffer.
- `GET /api/status` returns the most recent 250 captured log lines in chronological order.
- `GET /api/status` reports CPU, RAM used, and uptime scoped to the running Minecraft server process (PID), with `ram_allocated_mb` derived from the configured `SERVER_RAM`.
- Player counts in `GET /api/status` are dynamically queried via RCON `list` when `ONLINE`.

## Dependencies

- `axum`
- `axum-extra` with `cookie`
- `chrono`
- `clerk-rs` with `axum`
- `tokio` with `full`
- `tower`
- `futures-util`
- `serde`
- `serde_json`
- `dotenvy`
- `circular-queue`
- `rcon-tokio`
- `sysinfo`
- `tower-http` with `cors`

## Player API reference

A standalone reference for all player-related endpoints is in `PLAYER_API.md`. Update it when adding or changing player endpoints.

## File API reference

A standalone reference for all file-related endpoints is in `FILES_API.md`. Update it when adding or changing file endpoints.

## Development

- Use `cargo fmt`.
- Use `cargo check` for fast verification.
- Use `cargo build` for a full build.

## Maintenance

- Update this file when you think it is outdated.
