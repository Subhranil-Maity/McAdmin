// McAdminConsole runtime configuration.
//
// This file is loaded before the app bundle and is NOT processed by Vite, so it
// can be overwritten at deploy time (e.g. by a container entrypoint) without
// rebuilding the frontend.
//
// backendUrl:
//   - "http://host:8000" (or "host:8000") -> talk to the McAdminWorker at that address
//   - "same-origin"                      -> use the origin the console is served from
//                                           (frontend and /api behind one host/proxy)
//   - unset / ""                         -> fall back to VITE_BACKEND_URL from the build,
//                                           and if that is empty too, run in mock mode
//
// Example: window.__MCADMIN_CONFIG__ = { backendUrl: "same-origin" };
window.__MCADMIN_CONFIG__ = window.__MCADMIN_CONFIG__ || {};
