import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load all vars (not just VITE_*) from .env files so MCADMIN_WORKER_URL can live there too.
  const env = { ...loadEnv(mode, root, ""), ...process.env };

  // Where the dev/preview server forwards /api (incl. WebSockets). Used when the
  // console is configured with backendUrl / VITE_BACKEND_URL = "same-origin".
  const workerUrl = env.MCADMIN_WORKER_URL || "http://127.0.0.1:8000";

  const proxy: Record<string, ProxyOptions> = {
    "/api": { target: workerUrl, changeOrigin: true, ws: true },
  };

  const shared = {
    host: true,
    port: 3000,
    strictPort: true,
    // Replacement for Next's allowedDevOrigins.
    allowedHosts: ["vanguard.local"],
    proxy,
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": root },
    },
    server: shared,
    preview: shared,
    build: { outDir: "dist" },
  };
});
