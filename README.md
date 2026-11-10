<div align="center">

# McAdmin

**Run your Minecraft servers from a web page.**

Start and stop servers, chat in the console, install mods and invite friends to help, all from your browser.
No databases to set up, and it barely uses any of your computer's memory.

[![Built with Rust](https://img.shields.io/badge/Built_with-Rust-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Memory](https://img.shields.io/badge/Background_service-~17_MB_RAM-brightgreen?style=flat-square)](#light-on-your-computer)
[![No database](https://img.shields.io/badge/Database-not_needed-blue?style=flat-square)](#light-on-your-computer)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=flat-square)](LICENSE)

<img src="assets/dashboard.png" alt="McAdmin home screen showing two Minecraft servers, one online and one offline" width="900">

</div>

---

## What can it do?

### See all your servers at a glance

Every server gets a card showing whether it's online, its address, memory and how many players are on. Start or stop it with one click (that's the screen at the top of this page).

### Make a new server in seconds

Pick **Official**, **Fabric**, a **Modpack** or upload your own server file. Choose a Minecraft version from the list and McAdmin downloads everything for you, Java included.

<div align="center">

<img src="assets/create.png" alt="Create server window with version picker" width="850">

</div>

### Watch your server's health

See CPU and memory use as it happens. Change how much memory a server gets, or switch its Minecraft version, from the same page.

<div align="center">

<img src="assets/overview.png" alt="Server overview with CPU, memory and disk usage" width="850">

</div>

> [!NOTE]
> The **Disk Storage** (world size) card isn't working yet. It always shows a placeholder value (2.34 GB / 25 GB), not your server's real size. It will be fixed soon

### Use the live console

The server log streams in as it happens, and you can type commands like `/say`, `/time set day` or `/whitelist add` right in the browser.

<div align="center">

<img src="assets/console.png" alt="Live server console with a command box" width="850">

</div>

### Install mods with a click

Search [Modrinth](https://modrinth.com) from inside McAdmin and install Fabric mods, datapacks, resource packs and whole modpacks. Mods the server needs are added for you. Already have mods? McAdmin can recognise them and tell you when updates are out.

<div align="center">

<img src="assets/mods.png" alt="Mod browser showing popular Fabric mods" width="850">

</div>

### Edit files and settings without FTP

Browse your server's folders, upload files (up to 1 GB), and edit configs in the browser. Common settings like difficulty, game mode and view distance have simple controls, so you don't need to touch `server.properties` by hand.

<div align="center">

<table align="center">
  <tr>
    <td align="center"><img src="assets/files.png" alt="File manager"></td>
    <td align="center"><img src="assets/properties.png" alt="Server settings"></td>
  </tr>
</table>

</div>

### Let friends help, safely

Give each person only the access they need. Make someone a **Moderator** who can kick and ban but can't delete files, or a **Viewer** who can only watch. You can also pick permissions one by one, or make someone a full admin in one click.

<div align="center">

<img src="assets/team.png" alt="Team page showing an owner, a moderator and a viewer" width="850">

</div>

### Also included

- **Players & whitelist:** see who's online, then kick, ban, op or whitelist them.
- **Run many servers at once,** each with its own folder, port and memory limit.
- **Java handled for you:** the right Java version is downloaded automatically for each Minecraft version.
- **Safe shutdowns:** servers are told to save and `stop` properly before being closed.
- **Your own accounts:** logins are stored on your machine. Nothing goes to a third-party service.

---

## Light on your computer

McAdmin has two parts: a small background service written in **Rust** that looks after your servers, and the web page you use to control them.

Rust programs are fast and use very little memory, so your RAM goes to Minecraft instead of the control panel. There's no MySQL, Redis or Docker to install. All settings are saved as small files in one folder.

**Measured on Windows 11, running one Fabric 1.21.8 server with 4 GB assigned:**

| What | Memory used |
|---|---|
| McAdmin background service (Rust) | **~17 MB** |
| McAdmin web page server | ~100 MB |
| The Minecraft server itself | ~2,100 MB |
| Program size on disk | 11 MB |

The background service used **under 4 seconds of CPU time** in 10 minutes. That included downloading the server, setting up Fabric, starting the server and streaming its log. Almost all of your computer's power stays with Minecraft.

> Numbers will vary a little by system. The Minecraft server's memory depends on the amount you assign it.

---

## Coming soon

- 📦 **Direct download:** a ready-to-run app you can download and open, with no Rust or Bun needed.
- 🐳 **Docker container:** start McAdmin with a single `docker run` command.

Until then, follow the steps below to set it up.

---

## Getting started

### 1. Install what you need

| Tool | Why | Get it |
|---|---|---|
| **Rust** | Builds the background service | [rustup.rs](https://rustup.rs) |
| **Bun** | Builds the web page (only needed while building) | [bun.sh](https://bun.sh) |

You don't need to install Java or download a Minecraft server. McAdmin does both for you.

### 2. Download McAdmin

```bash
git clone https://github.com/Subhranil-Maity/McAdmin.git
cd McAdmin
```

### 3. Create the settings file

Copy the example and open it in any text editor:

```bash
cp McAdminWorker/.env.example McAdminWorker/.env
```

This is everything it can contain. Only the first three lines are required:

```env
# Which network address to listen on.
#   127.0.0.1 = only this computer can open the panel
#   0.0.0.0   = other computers on your network can open it too
ADMIN_WORKER_HOST=127.0.0.1

# The port the panel opens on: http://localhost:8000
ADMIN_WORKER_PORT=8000

# The folder where all your servers, worlds, mods and settings are kept.
# It is created if it doesn't exist; make sure your user can write to it.
HOME_DIR=/home/you/minecraft

# Secret used to sign logins. Type any long random text, and keep it private.
# If you change it later, everyone has to log in again.
JWT_SECRET=type-any-long-random-text-here

# Optional: address used to talk to your Minecraft servers' RCON (default 127.0.0.1).
# RCON_HOST=127.0.0.1

# Optional, advanced: only allow these other websites to use the API.
# Not needed for normal use, because the panel and the API share one address.
# CORS_ALLOWED_ORIGINS=http://localhost:3000
```

> [!TIP]
> Quick way to make a random secret: `openssl rand -hex 32`

### 4. Start it

```bash
./start.sh
```

The first run takes a few minutes. It builds the web page and the background service, then starts everything as **one program on one port**. Later runs only rebuild what changed. On Windows, run `start.sh` from Git Bash or WSL.

### 5. Open it

Go to **[http://localhost:8000](http://localhost:8000)** (or the port you set in `ADMIN_WORKER_PORT`) and create an account.

> [!IMPORTANT]
> **The first account you create becomes the owner** with full control. Make it yours before sharing the link with anyone.

Press `Ctrl+C` in the terminal to stop McAdmin. Any running Minecraft servers are shut down safely.

---

## Common questions

<details>
<summary><b>Which server types are supported?</b></summary>

Official (Mojang) and Fabric servers are downloaded automatically. For Paper, Purpur, Forge or anything else, choose **Custom JAR** and upload the server file yourself.
</details>

<details>
<summary><b>Can my friends reach the panel from their own computers?</b></summary>

Yes. Set `ADMIN_WORKER_HOST=0.0.0.0` in `McAdminWorker/.env`, restart McAdmin, and have them open `http://<your-computer's-address>:8000`. Nothing needs rebuilding, because the web page always talks to the address it was opened from.

If people will reach it over the internet, put it behind HTTPS and set `ADMIN_WORKER_HOST=127.0.0.1` so the panel can't be reached without it:
- **[Caddy](https://caddyserver.com)** (gets a certificate automatically), with a `Caddyfile` containing:
  ```
  panel.example.com {
      reverse_proxy 127.0.0.1:8000
  }
  ```
- **[Tailscale](https://tailscale.com)**: `tailscale serve 8000` gives you an HTTPS address that only your tailnet can open.

Minecraft itself doesn't go through HTTPS. Players connect to each server's own port as usual.
</details>

<details>
<summary><b>What if Modrinth or Mojang is down?</b></summary>

Your existing servers keep working. The version list and mod info are saved locally, and a **Retry** button appears when a download site can't be reached.
</details>

<details>
<summary><b>Where are my worlds stored?</b></summary>

Inside the `HOME_DIR` folder you chose, under `instances/`. Each server gets its own folder, so backing up is just copying that folder.
</details>

---

## For developers

Everything technical is below. Click a section to expand it.

<details>
<summary><b>Development mode & running each part by hand</b></summary>

- `./start.sh` (production): builds the console (`bun install` + `bun run build` -> `McAdminConsole/dist`), builds the worker in release mode, and runs **only the worker**. It serves the console and the API on one port, using `WEB_ROOT=McAdminConsole/dist`.
- `./start.sh -d` (development): `cargo run` in `McAdminWorker` plus the Vite dev server with hot reload (`bun run dev`) on [http://localhost:3000](http://localhost:3000).

`Ctrl+C` sends `SIGTERM` to the worker, which stops running Minecraft servers gracefully before exiting.

For development the console needs to know where the worker is. Create `McAdminConsole/.env.local` (see `McAdminConsole/.env.example`):

```env
# Where the browser reaches the worker:
#   same-origin           -> go through the dev server's /api proxy (recommended)
#   host:port or full URL -> talk to that worker directly
#   (empty)               -> mock mode, no backend
VITE_BACKEND_URL=same-origin

# Where the dev server's /api proxy (including WebSockets) forwards to
MCADMIN_WORKER_URL=http://127.0.0.1:8000
```

To run the two parts separately:

```bash
# Terminal 1: background service (Rust / Axum), http://127.0.0.1:8000
cd McAdminWorker
cargo run

# Terminal 2: web console (Vite + React Router), http://localhost:3000
cd McAdminConsole
bun install
bun run dev
```

Other console scripts: `bun run build` (typecheck + static build in `dist/` with precompressed `.br`/`.gz` files), `bun run start` (preview `dist/` on :3000), `bun run lint`.

</details>

<details>
<summary><b>Architecture Overview</b></summary>

```mermaid
flowchart TB
    subgraph Client ["Client Browser (Vite + React Router SPA, React 19)"]
        UI["McAdminConsole Dashboard"]
        WSCli["WebSocket Stream Manager"]
        AuthCtx["DashboardContext & AuthContext"]
    end

    subgraph Host ["Host Server"]
        subgraph Daemon ["McAdminWorker (Rust + Axum)"]
            Router["Axum Router & Tower Middleware"]
            Static["Web Console Files\n(WEB_ROOT = McAdminConsole/dist)"]
            AuthGuard["Auth & Role Guard\n(Argon2id + JWT + require_permissions)"]
            WSHandler["WebSocket Handler\n(/api/instances/{id}/ws)"]
            ProcMgr["Process Manager\n(Tokio Child Processes)"]
            LogRing["Log Ring Buffer & Broadcast\n(circular-queue + tokio::sync::broadcast)"]
            RconClient["RCON Tokio Client"]
            SysInfo["SysInfo Telemetry Engine"]
        end

        subgraph Storage ["Home Directory (/minecraft)"]
            UsersJSON[("users.json\n(Users & Auth)")]
            JavaJSON[("java_runtimes.json\n(Detected JVMs)")]
            subgraph Instances ["instances/"]
                SrvA["srv-alpha/\nserver.jar + server.properties + roles.json"]
                SrvB["srv-beta/\nserver.jar + server.properties + roles.json"]
            end
        end

        subgraph JVMs ["Active Minecraft Server Processes"]
            MC1["Minecraft JVM (Java 21)\nPort 25565 | RCON 25575"]
            MC2["Minecraft JVM (Java 8)\nPort 25566 | RCON 25576"]
        end
    end

    UI -->|"Loads page & assets (same origin)"| Static
    UI -->|"HTTP REST API (JWT Bearer / Cookie)"| Router
    WSCli <-->|"Full-Duplex WebSocket (/ws)"| WSHandler
    Router --> AuthGuard
    AuthGuard --> UsersJSON
    AuthGuard --> Instances
    WSHandler --> AuthGuard
    WSHandler <--> LogRing
    WSHandler <--> RconClient
    WSHandler <--> SysInfo
    Router --> ProcMgr
    Router --> RconClient
    Router --> SysInfo
    ProcMgr --> JavaJSON
    ProcMgr -->|"Spawn & Monitor"| MC1
    ProcMgr -->|"Spawn & Monitor"| MC2
    MC1 -->|"stdout / stderr"| LogRing
    MC2 -->|"stdout / stderr"| LogRing
    RconClient -->|"TCP RCON Commands"| MC1
    RconClient -->|"TCP RCON Commands"| MC2
    ProcMgr --> Instances
```

</details>

<details>
<summary><b>Repository Structure</b></summary>

```text
mcadmin/
|-- McAdminWorker/           # Rust / Axum backend daemon
|   |-- src/
|   |   |-- api/             # HTTP & WebSocket route handlers
|   |   |   |-- auth.rs      # User login, registration, me endpoint
|   |   |   |-- instances.rs # Instance lifecycle, WebSocket, files, players
|   |   |   |-- java_runtimes.rs # Java detection & runtime management
|   |   |   \-- users.rs     # User management (superuser only)
|   |   |-- auth.rs          # JWT validation & password hashing (Argon2id)
|   |   |-- instance_config.rs # Master configuration (mc_config.json)
|   |   |-- instance_manager.rs # Multi-instance lifecycle manager
|   |   |-- instance_runtime.rs # Tokio process runtime & log buffer
|   |   |-- java_manager.rs  # Java detection & path resolution
|   |   |-- role_manager.rs  # 18-point granular permissions engine
|   |   |-- web.rs           # Serves the built web console (WEB_ROOT) + /config.js
|   |   \-- main.rs          # Entry point, router wiring, CORS, log redaction & server bind
|   |-- Cargo.toml           # Rust package configuration & dependencies
|   \-- AGENTS.md            # Backend developer guide & technical notes
|-- McAdminConsole/          # Vite + React Router web console (static SPA)
|   |-- index.html           # SPA entry (loads /config.js, then app/main.tsx)
|   |-- app/
|   |   |-- main.tsx         # Bootstraps React, router and fonts
|   |   |-- routes.tsx       # Route tree (/, /dashboard/:uuid/<tab>, ...)
|   |   |-- dashboard/       # Main server control panel pages & layouts
|   |   |-- manageuser/      # User management view (superuser only)
|   |   \-- layout.tsx       # Root layout (auth provider + app shell)
|   |-- components/
|   |   |-- dashboard/       # Dashboard tabs (console, files, players, admins, properties)
|   |   \-- ui/              # Radix UI / Shadcn accessible primitives
|   |-- lib/
|   |   |-- auth/            # Client-side authentication context & backend health checks
|   |   \-- mc-server/       # API clients (instances, files, status, players)
|   |-- public/config.js     # Runtime config (backendUrl); the worker generates its own
|   |-- scripts/compress.ts  # Writes .br/.gz copies of the build for the worker
|   |-- types/               # Shared TypeScript models & role definitions
|   |-- vite.config.ts       # Vite config (dev server, /api proxy, Tailwind)
|   \-- package.json         # Bun dependencies & scripts
|-- start.sh                 # Unified process orchestration script (dev / prod)
\-- README.md                # Project documentation
```

</details>

<details>
<summary><b>Configuration Reference</b></summary>

#### `McAdminWorker` Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_WORKER_HOST` | Yes | `127.0.0.1` | Network interface IP to bind (e.g. `0.0.0.0` or `127.0.0.1`). |
| `ADMIN_WORKER_PORT` | Yes | `8000` | HTTP and WebSocket port to listen on. |
| `HOME_DIR` | Yes | - | Absolute or relative path to the root storage directory. |
| `RCON_HOST` | No | `127.0.0.1` | Hostname/IP used by the worker to connect to local instance RCON ports. |
| `JWT_SECRET` | No | *Internal key* | HMAC-SHA256 secret for signing and verifying user JWT tokens. |
| `WEB_ROOT` | No | *unset* | Folder with the built console (`McAdminConsole/dist`); `start.sh` sets it. When set, the worker serves the console on its own port: SPA fallback to `index.html`, precompressed assets, long-term caching for `/assets/*`. Unset = API only, and `GET /` is a health check. |
| `WEB_BACKEND_URL` | No | `same-origin` | `backendUrl` handed to the console through the generated `/config.js` when `WEB_ROOT` is set. |
| `CORS_ALLOWED_ORIGINS` | No | *mirror any origin* | Comma-separated origins allowed to call the API cross-origin (e.g. `http://localhost:3000`). Not needed when the worker serves the console itself. |

Request logs redact `token`/`password` query values, so JWTs passed to WebSockets (`?token=`) never reach log files. `GET /api/health` is an always-available health check.

#### `McAdminConsole` Environment Variables (development only)

Put these in `McAdminConsole/.env.local`. A production build served by the worker doesn't need them, because the worker's `/config.js` overrides `VITE_BACKEND_URL`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_BACKEND_URL` | No | `""` | Where the browser reaches the worker: `same-origin`, `host:port` or a full URL. Empty (and no runtime config) means mock mode. |
| `MCADMIN_WORKER_URL` | No | `http://127.0.0.1:8000` | Dev/preview server only: target of the `/api` (+ WebSocket) proxy used with `same-origin`. |

</details>

<details>
<summary><b>18-Point Granular Permissions Matrix</b></summary>

Permissions are enforced per instance in `roles.json` and validated by Axum request guards:

| Category | Permission Key | API Scope | Administrator | Moderator | Viewer |
|---|---|---|:---:|:---:|:---:|
| **Server Operations** | `server_start` | `server:start` | Yes | Yes | No |
| | `server_stop` | `server:stop` | Yes | Yes | No |
| | `server_restart` | `server:restart` | Yes | Yes | No |
| **Logs & Console** | `logs_view` | `logs:view` | Yes | Yes | Yes |
| | `console_send` | `console:send` | Yes | Yes | No |
| **Player Management** | `players_view` | `players:view` | Yes | Yes | Yes |
| | `players_kick` | `players:kick` | Yes | Yes | No |
| | `players_ban` | `players:ban` | Yes | Yes | No |
| | `players_op` | `players:op` | Yes | No | No |
| **Whitelist Controls** | `whitelist_view` | `whitelist:view` | Yes | Yes | Yes |
| | `whitelist_manage` | `whitelist:manage` | Yes | Yes | No |
| **File Manager** | `files_read` | `files:read` | Yes | Yes | Yes |
| | `files_edit` | `files:edit` | Yes | No | No |
| | `files_upload` | `files:upload` | Yes | No | No |
| | `files_delete` | `files:delete` | Yes | No | No |
| **Server Properties** | `properties_view` | `properties:view` | Yes | Yes | Yes |
| | `properties_edit` | `properties:edit` | Yes | No | No |
| **Team & Member Access** | `members_manage` | `members:manage` | Yes | No | No |

</details>

<details>
<summary><b>WebSocket protocol (<code>/api/instances/{id}/ws</code>)</b></summary>

Full-duplex WebSocket connections support both binary-safe streaming and structured JSON frames.

#### Handshake & Authentication
Connect via `ws://<host>:<port>/api/instances/{id}/ws?token=<jwt_token>` (or using the `mcadmin_token` cookie).

#### Client Frames (Inbound)
```json
// Subscribe to live stdout/stderr log stream and receive backlog
{ "type": "subscribe_logs" }

// Stop log streaming
{ "type": "unsubscribe_logs" }

// Connection heartbeat
{ "type": "ping" }

// Execute server command via RCON (requires console:send)
{ "type": "command", "command": "time set day" }
```

#### Server Frames (Outbound)
```json
// Live Telemetry Packet (Broadcasted every 1.5s)
{
  "type": "status",
  "data": {
    "status": "Online",
    "cpu_usage": 12.4,
    "memory_bytes": 2147483648,
    "max_memory_bytes": 4294967296,
    "online_players": 3,
    "max_players": 20
  }
}

// Log Backlog Catch-Up
{
  "type": "log_backlog",
  "logs": [
    { "index": 1, "line": "[12:00:00 INFO]: Starting Minecraft server...", "level": "INFO" }
  ]
}

// Live Stream Log Event
{
  "type": "log",
  "data": { "index": 2, "line": "[12:00:05 INFO]: Done (2.41s)! For help, type \"help\"", "level": "INFO" }
}

// Command Response
{
  "type": "command_result",
  "status": "ok",
  "command": "time set day",
  "response": "Set the time to 1000"
}
```

</details>

<details>
<summary><b>Testing & Verification</b></summary>

#### Run Backend Unit Tests
```bash
cd McAdminWorker
cargo test
```
Runs unit tests for permission string mappings, split preset behaviors, legacy backward-compatibility, and thread-safe log buffer operations.

#### Typecheck & Build Frontend
```bash
cd McAdminConsole
bun run build
```
Typechecks with `tsc`, builds the static SPA into `dist/` with Vite, and writes precompressed `.br`/`.gz` copies for the worker. Run `bun run lint` for ESLint.

</details>

---

## License

MIT. See [LICENSE](LICENSE).
