# 🎮 MCAdminConsole

[![Next.js](https://img.shields.io/badge/Next.js-16.2.0-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0.0-blue?style=flat-square&logo=react)](https://react.dev/)
[![Clerk](https://img.shields.io/badge/Auth-Clerk%20v7-purple?style=flat-square)](https://clerk.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](#license)

`MCAdminConsole` is a premium, web-based server administration dashboard designed specifically to manage Minecraft servers. It acts as the user interface/console for `McAdminWorker`—a backend runner daemon that runs alongside the Minecraft server process. 

This project is a recreation of server panel dashboards, optimized for high responsiveness, real-time logging, interactive console commands, and full file-system browsing.

---

## 🌟 Key Features

* **⚡ Real-Time Monitoring & Controls**: Live telemetry for CPU and RAM consumption, uptime, active player counts, and server version. Power buttons allow one-click **Start**, **Stop**, and **Restart** triggers.
* **💻 Interactive Console**: Send commands directly to the Minecraft server console and watch live-parsed log streams filter info, warning, and error messages.
* **📂 Full File Management**: Router-aware file browser directory traversal tree, supporting file views, creating/editing text configurations (e.g. `server.properties`, `spigot.yml`), and secure file uploading with dynamic progress bars.
* **👥 Player Administration**: Track active online players, invoke actions like `kick`, `ban`/`unban`, `op`/`deop`, or configure the server `whitelist`/`dewhitelist`.
* **⚙️ Server Properties Panel**: Simplified configuration UI split into **Frequent Settings** (like difficulty, PvP, Max Players) and **Raw Properties** edit tools.
* **🔌 Plugin Manager**: List installed plugins, toggle their enabled states, or upload new `.jar` plugin assets directly.

---

## 🛡️ Role-Based Access Control (RBAC)

Authentication is handled securely via **Clerk**. Permissions are mapped using the `role` field stored within each user's Clerk `publicMetadata`.

### Roles & Permissions Matrix

| Permission / Action | `OWNER` | `ADMIN` | `NORMUSER` |
| :--- | :---: | :---: | :---: |
| **View Dashboard** | ✅ | ✅ | ✅ |
| **Monitor Metrics & Status** | ✅ | ✅ | ✅ |
| **Start Server** | ✅ | ✅ | ✅ |
| **Execute Console Commands** | ✅ | ✅ | ❌ |
| **Edit Config / Files** | ✅ | ✅ | ❌ |
| **Player Ops (`ban`/`op`)** | ✅ | ✅ | ❌ |
| **Read User Directory List** | ✅ | ✅ | ❌ |
| **Manage Clerk User Roles** | ✅ | ❌ | ❌ |

> [!NOTE]
> In **Development Mode** (`process.env.NODE_ENV === "development"`), role restrictions for managing and viewing user roles are bypassed to facilitate easy debugging.

---

## 🔗 Integration with `McAdminWorker`

`MCAdminConsole` is built to communicate with `McAdminWorker`, which must be running on the host machine hosting the Minecraft server.

If the environment variable `NEXT_PUBLIC_BACKEND_URL` is **not set**, `MCAdminConsole` automatically enters **Mock Sandbox Mode**—simulating all APIs with generated, random metrics, and a virtual static filesystem (`/plugins`, `/logs`, `server.properties`, etc.) for local testing.

### Supported Worker API Endpoints

The console integrates with the following routes on the `McAdminWorker` host:

* `GET /api/status` - Returns overall server state, CPU usage, RAM utilization, active players, and the last 100 log lines.
* `POST /api/server/start` - Launches the Minecraft server process.
* `POST /api/server/stop` - Gracefully halts the Minecraft server process.
* `POST /api/server/command` - Dispatches console commands directly to the server input stream (`stdin`).
* `GET /api/files?path=<path>` - Lists files & folders within the server folder tree.
* `GET /api/files/content?path=<path>` - Retrieves the text content of a server file (capped at 5MB, binary files rejected).
* `POST /api/files/write` - Overwrites file content.
* `POST /api/files/upload` - Handles file uploads using multipart form uploads.
* `GET /api/server/players` - Retrieves list of cached offline/historical players.
* `GET /api/server/players/online` - Retrieves a list of active online player usernames.
* `POST /api/server/players/ban` - Bans a player.
* `POST /api/server/players/unban` - Unbans a player.
* `POST /api/server/players/op` - Ops a player.
* `POST /api/server/players/deop` - De-ops a player.
* `POST /api/server/players/whitelist` - Adds a player to the server whitelist.
* `POST /api/server/players/dewhitelist` - Removes a player from the server whitelist.

---

## ⚙️ Environment Variables Setup

Create a `.env.local` file in the root directory of the project:

```env
# Clerk Authentication Configuration
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

# McAdminWorker API Backend URL
NEXT_PUBLIC_BACKEND_URL=localhost:8000
```

---

## 🚀 Getting Started

### Prerequisites

You need **Bun** (recommended) or Node.js (v18+) installed on your machine.

### Installation

1. Clone the repository.
2. Install dependencies:

```bash
bun install
# or
npm install
```

### Run the Development Server

Start the Next.js server locally:

```bash
bun dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your web browser.

### Build for Production

Compile a production bundle:

```bash
bun run build
bun start
# or
npm run build
npm start
```

---

## 🛠️ Project Structure

```text
├── app/
│   ├── actions/          # Next.js Server Actions (Clerk role updates)
│   ├── dashboard/        # Layout & Sub-sections (overview, console, files, players, properties, whitelist)
│   ├── manageuser/       # User management screen (Owner only)
│   ├── layout.tsx        # App root layout, wrapping ClerkProvider
│   └── page.tsx          # Landing / Entry page
├── components/           # Reusable UI widgets
├── lib/
│   ├── mc-server/        # Client API services mapping to McAdminWorker endpoints
│   └── utils.ts          # Tailwind CSS merge utilities
├── types/
│   ├── roles.ts          # App RBAC user definitions and permission rules
│   └── index.ts          # Core shared typings
└── package.json
```

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
