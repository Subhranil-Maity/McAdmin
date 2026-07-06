# mc_admin_worker

Rust/Axum service for managing a Minecraft server worker process.

## Runtime

- Loads `.env` at startup with `dotenvy`.
- Requires `ADMIN_WORKER_HOST`, `ADMIN_WORKER_PORT`, and `HOME_DIR`.
- Binds the HTTP server from `ADMIN_WORKER_HOST:ADMIN_WORKER_PORT`.
- Uses `HOME_DIR` as the Minecraft server directory.
- Reads config from `HOME_DIR/admin_worker_config.json`.
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
  - Health response for the worker.
- `GET /api/status`
  - Returns worker/server runtime status and system metrics.
- `POST /api/server/start`
  - Starts the Minecraft server process.
- `POST /api/server/stop`
  - Stops the running Minecraft server process.
- `GET /api/config`
  - Lists persisted config entries.
- `GET /api/config/{key}`
  - Reads one persisted config entry.

## Server lifecycle

- The runtime tracks Minecraft state in memory.
- Status values are `OFFLINE`, `STARTING`, and `ONLINE`.
- Starting the server spawns `java -jar <jar> nogui` with `-Xms` and `-Xmx` based on `SERVER_RAM`.
- Stopping the server kills the stored child process handle and clears runtime state.
- Recent logs are currently returned as an empty vector.
- Player counts are currently stubbed at `active_players = 0` and `max_players = 10`.

## Dependencies

- `axum`
- `tokio` with `full`
- `serde`
- `serde_json`
- `dotenvy`
- `sysinfo`
- `tower-http` with `cors`

## Development

- Use `cargo fmt`.
- Use `cargo check` for fast verification.
- Use `cargo build` for a full build.

## Maintenance

- Update this file when you think it is outdated.
