/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time fallback for the McAdminWorker URL (e.g. "127.0.0.1:8000" or "same-origin"). */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface McAdminRuntimeConfig {
  /** Worker base URL, or "same-origin". Overrides VITE_BACKEND_URL when set. */
  backendUrl?: string;
}

interface Window {
  __MCADMIN_CONFIG__?: McAdminRuntimeConfig;
}
