# McAdminWorker

A background worker service for orchestrating Minecraft server instances locally or on a remote server. Built with Rust and Axum.

Designed to work with [McAdminConsole](https://github.com) as the frontend control panel.

> Primarily a recreational project.

## What it does

- Start, stop, and manage Minecraft server processes
- Send commands to the server via RCON
- Manage players (op, whitelist, ban)
- Edit server properties
- Browse and modify server files
- Real-time status and log streaming
- Clerk-based authentication with role-based access (admin/owner)

## Requirements

- Rust 1.75+
- Java (for running the Minecraft server)
- A Minecraft `server.jar` in the working directory

## Setup

1. Copy `.env.example` to `.env` and fill in the values:

```env
ADMIN_WORKER_HOST=localhost
ADMIN_WORKER_PORT=8000
HOME_DIR=/path/to/minecraft/server

RCON_HOST=localhost
RCON_PORT=25575
RCON_PASSWORD=your_rcon_password

CLERK_SECRET_KEY=sk_your_clerk_secret_key
```

2. Build and run:

```sh
cargo build --release
cargo run
```

The server binds to `ADMIN_WORKER_HOST:ADMIN_WORKER_PORT`.

## API

Public endpoints (no auth):
- `GET /` — health check
- `GET /api/status` — server status, system metrics, recent logs

All other endpoints require a valid Clerk session (`Authorization: Bearer <token>` or `__session` cookie) with `public_metadata.role` set to `"admin"` or `"owner"`.

See [AGENTS.md](AGENTS.md) for the full API reference.

## Auth

Uses [Clerk](https://clerk.com) for authentication via [clerk-rs](https://github.com/DarrenBaldwin07/clerk-rs). The frontend sets user roles in Clerk's `publicMetadata`:

```ts
await clerkClient().users.updateUserMetadata(userId, {
  publicMetadata: { role: "admin" },
});
```

The worker verifies the JWT, fetches the user from Clerk's Backend API, and checks the role. Roles are cached in-memory for 60 minutes.

## Dependencies

- `axum` — HTTP framework
- `clerk-rs` — Clerk SDK for JWT verification and user lookup
- `rcon-tokio` — Minecraft RCON client
- `sysinfo` — system metrics
- `tokio` — async runtime
- `tower-http` — CORS middleware

## License

[MIT](LICENSE)
