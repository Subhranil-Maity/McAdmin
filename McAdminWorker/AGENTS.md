# mc_admin_worker

Rust/Axum service for managing a Minecraft server worker process.

## Runtime

- Loads `.env` at startup with `dotenvy`.
- Requires `ADMIN_WORKER_HOST`, `ADMIN_WORKER_PORT`, and `HOME_DIR`.
- Requires `RCON_HOST`, `RCON_PORT`, and `RCON_PASSWORD` for RCON command forwarding.
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
  - Health response for the worker.
- `GET /api/status`
  - Returns worker/server runtime status and system metrics.
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
- `GET /api/config`
  - Lists persisted config entries.
- `GET /api/config/{key}`
  - Reads one persisted config entry.

## Server lifecycle

- The runtime tracks Minecraft state in memory.
- Status values are `OFFLINE`, `STARTING`, and `ONLINE`.
- Starting the server spawns `java -jar <jar> nogui` with `-Xms` and `-Xmx` based on `SERVER_RAM`.
- Stopping the server kills the stored child process handle and clears runtime state.
- Server commands are sent with `rcon-tokio` through a shared RCON client stored in app state.
- Recent logs are captured from the Minecraft process stdout/stderr into a 15,000-line circular buffer.
- `GET /api/status` returns the most recent 250 captured log lines in chronological order.
- Player counts are currently stubbed at `active_players = 0` and `max_players = 10`.

## Dependencies

- `axum`
- `tokio` with `full`
- `serde`
- `serde_json`
- `dotenvy`
- `circular-queue`
- `rcon-tokio`
- `sysinfo`
- `tower-http` with `cors`

## Development

- Use `cargo fmt`.
- Use `cargo check` for fast verification.
- Use `cargo build` for a full build.

## Maintenance

- Update this file when you think it is outdated.
