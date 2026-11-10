#!/usr/bin/env bash
set -e

# Production (default): build the web console, then run the worker alone; it
#   serves the console and the API on one port (ADMIN_WORKER_PORT, default 8000).
# Debug (-d): worker via `cargo run` + Vite dev server with hot reload on :3000.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEBUG_MODE=false

while getopts "d" opt; do
  case "$opt" in
    d)
      DEBUG_MODE=true
      ;;
    *)
      echo "Usage: $0 [-d]"
      echo "  (none)  Production: build the console, worker serves it on one port"
      echo "  -d      Debug: cargo run + bun run dev (hot reload on :3000)"
      exit 1
      ;;
  esac
done

PIDS=()

# Stop every service with SIGTERM and wait, so the worker can stop its
# Minecraft servers gracefully (saving worlds) before exiting.
cleanup() {
    trap - SIGINT SIGTERM EXIT
    echo ""
    echo "[!] Stopping all running services..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo "[✓] All services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

if [ "$DEBUG_MODE" = true ]; then
    echo "=========================================="
    echo "       STARTING IN DEBUG MODE (-d)        "
    echo "=========================================="

    # `exec` makes each PID the real process (cargo run replaces itself with the
    # worker on Unix), so cleanup's SIGTERM reaches it directly.
    echo "[+] Starting McAdminWorker (cargo run)..."
    (cd "$ROOT/McAdminWorker" && exec cargo run) &
    PIDS+=($!)

    echo "[+] Starting McAdminConsole (bun run dev, http://localhost:3000)..."
    (cd "$ROOT/McAdminConsole" && exec bun run dev) &
    PIDS+=($!)

else
    echo "=========================================="
    echo "       STARTING IN PRODUCTION MODE        "
    echo "=========================================="

    echo "[+] Building McAdminConsole (bun install + bun run build)..."
    (cd "$ROOT/McAdminConsole" && bun install --frozen-lockfile && bun run build)

    echo "[+] Building McAdminWorker (cargo build --release)..."
    (cd "$ROOT/McAdminWorker" && cargo build --release)

    # The worker serves the built console from WEB_ROOT; an explicit WEB_ROOT in
    # the environment wins (dotenvy never overrides existing variables).
    export WEB_ROOT="${WEB_ROOT:-$ROOT/McAdminConsole/dist}"

    echo "[+] Starting McAdminWorker (API + web console from $WEB_ROOT)..."
    (cd "$ROOT/McAdminWorker" && exec ./target/release/mc_admin_worker) &
    PIDS+=($!)
fi

# For HTTPS, put a reverse proxy in front of the worker, e.g. a Caddyfile with:
#   panel.example.com {
#       reverse_proxy 127.0.0.1:8000
#   }

echo ""
echo "[✓] All services are up!"
echo "Press Ctrl+C to stop all."

wait
