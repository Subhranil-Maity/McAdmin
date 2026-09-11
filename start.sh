#!/usr/bin/env bash
set -e

# Default to production mode
DEBUG_MODE=false

# Parse flags
while getopts "d" opt; do
  case "$opt" in
    d)
      DEBUG_MODE=true
      ;;
    *)
      echo "Usage: $0 [-d]"
      echo "  -d    Run in debug mode (cargo run / bun run dev)"
      exit 1
      ;;
  esac
done

PIDS=()

# Cleanup function to kill all spawned child processes
cleanup() {
    echo ""
    echo "[!] Stopping all running services..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null
    echo "[✓] All services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

if [ "$DEBUG_MODE" = true ]; then
    echo "=========================================="
    echo "       STARTING IN DEBUG MODE (-d)        "
    echo "=========================================="

    echo "[+] Starting McAdminWorker (cargo run)..."
    (cd ./McAdminWorker && cargo run) &
    PIDS+=($!)

    echo "[+] Starting McAdminConsole (bun run dev)..."
    (cd ./McAdminConsole && bun run dev) &
    PIDS+=($!)

else
    echo "=========================================="
    echo "       STARTING IN PRODUCTION MODE        "
    echo "=========================================="

    echo "[+] Starting McAdminWorker (cargo run --release)..."
    (cd ./McAdminWorker && cargo run --release) &
    PIDS+=($!)

    echo "[+] Building McAdminConsole (bun run build)..."
    # (cd ./McAdminConsole && bun run build)

    echo "[+] Starting McAdminConsole (bun run start)..."
    (cd ./McAdminConsole && bun run start) &
    PIDS+=($!)
fi

# echo "[+] Starting Caddy Reverse Proxy..."
# sudo caddy run --config ./Caddyfile &
# PIDS+=($!)

echo ""
echo "[✓] All services are up!"
echo "Press Ctrl+C to stop all."

# Wait for background processes
wait
