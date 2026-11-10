# McAdminConsole: Static Build & Framework Report

**Date:** 2026-11-10 | **Scope:** `McAdminConsole/` (frontend only) | **Status:** analysis and recommendation, no code changed

## 1. Summary

**Goal:** package the frontend as a plain static website (HTML, JS and CSS that any file server or container can serve), keep every feature working, and keep `bun run dev` / `bun run start` working. This sets up Dockerization.

**Key finding:** McAdminConsole is already a client-side SPA running inside Next.js. Every page and component is `"use client"`. All data goes from the browser straight to the Rust worker over REST and a WebSocket. The app uses no route handlers, server actions, `next/headers`, cookies, middleware or `next/image`. Next's server runtime does no real work here; it only serves the app.

That makes a static build cheap to reach. Only six things block it (§2.2), and most of them are framework-independent.

**Recommendation**

| Rank | Option | When to pick it |
|---|---|---|
| 1 | **Vite + React Router v7 (SPA mode), run by Bun** | Best long-term fit: a true SPA, native dynamic `:uuid` routes, a small fast toolchain and the simplest Docker image. About 1–2 days of migration. |
| 2 | **Next.js `output: "export"`** | When the smallest diff matters most. You keep Next but need a workaround for `/dashboard/[uuid]/…` (§5.A). |
| ✗ | Astro, SvelteKit, SolidStart | Not recommended for this app (§5.F–G). |

Whichever framework you pick, do **runtime backend configuration** and a **Bun static server for `bun run start`** first (§4). They fix the biggest Docker problem, a backend URL baked in at build time, and they carry over unchanged to any framework.

---

## 2. Current architecture audit

### 2.1 Stack
- Next.js 16.2.10 (App Router), React 19.2.4, Tailwind CSS 4 (`@tailwindcss/postcss`), shadcn + `@base-ui/react`, lucide-react.
- Package manager and runtime: Bun 1.4 (`bun.lock`).
- `next.config.ts`: `output: 'standalone'`, `allowedDevOrigins: ['vanguard.local']`.
- `start.sh` runs `bun run dev` (debug) or `bun run start` (prod). The `bun run build` step is commented out, so prod start relies on a stale `.next/` (currently about 449 MB on disk).
- About 9.6k lines of TSX across `app/` and `components/`.

### 2.2 What blocks a static build

| # | Blocker | Where | Impact |
|---|---|---|---|
| 1 | Dynamic route `app/dashboard/[uuid]/*` with a **server** layout that `await params` | `app/dashboard/[uuid]/layout.tsx` | Static export needs `generateStaticParams()` at build time, but instance UUIDs only exist at runtime. **This is the main structural blocker.** |
| 2 | Server-side `redirect()` | `app/dashboard/[uuid]/page.tsx`, and the legacy stubs `app/dashboard/{console,files,overview,players,plugins,properties,whitelist}/page.tsx` | These need a server. They must become client redirects or route-config redirects. |
| 3 | `process.env.NODE_ENV` read in a server layout to set `isDev` | `app/dashboard/[uuid]/layout.tsx:12` (also `app/dashboard/page.tsx:18`, `components/dashboard/admins-tab.tsx:118`) | Easy to fix: it's inlined at build time by every bundler, or use `import.meta.env.DEV`. |
| 4 | `next start` / `output: 'standalone'` | `package.json`, `next.config.ts` | `next start` can't serve a static export, so `bun run start` must be redefined. |
| 5 | **Backend URL baked in at build time** | `getBackendBaseUrl()` in `lib/mc-server/utils.ts:9` reads `NEXT_PUBLIC_BACKEND_URL` (`.env` = `100.99.169.51:8000`) | `NEXT_PUBLIC_*` values are compiled into the JS bundle, so one Docker image can't run on several hosts. **This is the biggest Docker problem, and no framework fixes it by itself.** |
| 6 | `next/font/google` (Inter, Geist, Geist Mono) | `app/layout.tsx` | Works with static export but downloads fonts at build time, so the Docker build needs internet. Self-hosting via `@fontsource/*` removes that. |

> **Subtle trap:** today an *empty* `getBackendBaseUrl()` means "no backend" (mock/fallback branches in `lib/mc-server/players.ts:22`, `whitelist.ts:14`, the WS fallback in `dashboard-context.tsx:350`, and `checkBackendHealth`). So "same origin" can't be expressed as an empty string; it needs an explicit value (§4.1).

### 2.3 Next-specific APIs in use (20 files)

| API | Files |
|---|---|
| `next/link` | `app/page.tsx`, `app/serverstatus/page.tsx`, `app/manageuser/page.tsx`, `app/manageuser/manage-users-client.tsx`, `components/app-shell.tsx`, `components/navbar-links.tsx`, `components/dashboard/{server-grid,files-tab,dashboard-client-layout}.tsx` |
| `next/navigation` `useRouter` | `app/dashboard/layout.tsx`, `app/serverstatus/page.tsx`, `components/dashboard/create-instance-dialog.tsx` |
| `next/navigation` `usePathname` | `components/navbar-links.tsx`, `components/dashboard/dashboard-client-layout.tsx` |
| `next/navigation` `redirect` | 8 stub pages (§2.2 #2) |
| `next/font/google`, `Metadata` | `app/layout.tsx` |

Everything else (`lib/`, `components/ui/`, most of `components/dashboard/`) is framework-agnostic React plus `fetch`/`WebSocket`, so it moves to any React tool as is.

### 2.4 Backend facts that matter
- **CORS:** `McAdminWorker/src/main.rs:324` mirrors any origin and sets `allow_credentials(true)`, so cross-origin hosting works today.
- **Auth:** a JWT in `localStorage` plus a `mcadmin_token` cookie (`SameSite=Lax`, set from JS). `apiFetch` sends `Authorization: Bearer` with `credentials: "include"`. The WebSocket passes `?token=` (`getBackendWsUrl`).
- **No static-file serving:** `tower-http` only has the `cors` and `trace` features. Adding `fs` (`ServeDir` + `ServeFile` fallback) would let the worker serve the SPA itself (§4.3).
- All routes live under `/api/*` (plus `/` health), so a same-origin reverse proxy is a single prefix rule.

---

## 3. Requirements

1. **Static output:** `bun run build` emits a folder (`out/` or `dist/`) of plain files.
2. **Full functionality:** REST, the WebSocket console and metrics, multipart uploads (up to 1 GB, sent directly to the worker), auth, every dashboard tab and deep links such as `/dashboard/<uuid>/files?path=/world&edit=level.dat`.
3. **`bun run dev`:** hot reload against a running worker.
4. **`bun run start`:** serves the production build without Node or Next.
5. **Docker-ready:** one image, with the backend URL set at **runtime** via env.
6. **Bun throughout:** install, scripts, dev server and production static server.

---

## 4. Framework-independent design (do this first)

### 4.1 Runtime configuration
Replace build-time `NEXT_PUBLIC_BACKEND_URL` with a tiny file loaded before the app bundle:

```html
<!-- index.html / root layout head -->
<script src="/config.js"></script>
```
```js
// /config.js (generated at container start / by the start server)
window.__MCADMIN_CONFIG__ = { backendUrl: "same-origin" };
```

Resolution order in `getBackendBaseUrl()`:
1. `window.__MCADMIN_CONFIG__.backendUrl`
2. The build-time env (`NEXT_PUBLIC_BACKEND_URL` / `VITE_BACKEND_URL`), so current dev setups keep working.
3. `"same-origin"` maps to `window.location.origin`. This value is explicit so the existing "empty means no backend" mock behaviour stays intact.

`getBackendWsUrl()` already derives `ws://`/`wss://` from the base, so it works unchanged with same-origin.

**Same-origin is the preferred production mode.** The frontend and `/api` sit behind one host (Bun proxy, Caddy, nginx or the worker itself). That removes CORS entirely, lets the cookie work cleanly, and hides the worker port.

### 4.2 `bun run start` becomes a small `Bun.serve` script
About 40 lines, `serve.ts`, no dependencies:
- serves `dist/`/`out/` with long-cache headers for hashed assets and `no-cache` for `index.html` and `config.js`;
- **SPA fallback:** unknown paths return `index.html` (needed for `/dashboard/<uuid>/…` deep links);
- generates `/config.js` from `MCADMIN_BACKEND_URL` env;
- optional: proxies `/api/*` and WebSocket upgrades to `MCADMIN_WORKER_URL` (e.g. `http://127.0.0.1:8000`) for single-port, same-origin deployments.

This keeps `bun run start` meaningful, needs no `node_modules` at runtime, and starts in milliseconds.

### 4.3 Hosting options for the static output

| Host | Pros | Cons |
|---|---|---|
| **Bun `serve.ts`** (§4.2) | Same command dev and prod, runtime config built in, WS proxy, one language | You maintain about 40 lines |
| **Caddy / nginx** | Battle-tested, gzip/brotli, TLS (Caddy auto-HTTPS), trivial SPA fallback + `/api` proxy | One more config file; `config.js` written by an entrypoint script |
| **Rust worker** (`tower-http` `fs`: `ServeDir::new("dist").fallback(ServeFile::new("dist/index.html"))`) | **One process, one container, one port**, same-origin for free, smallest footprint (fits the "under 20 MB" ethos) | Couples the frontend release to the worker; small Rust change |
| Any CDN / static host | Zero ops | Cross-origin to the worker; needs public worker exposure |

### 4.4 Docker sketch (target shape)

```dockerfile
# ---- build frontend ----
FROM oven/bun:1.4-alpine AS web
WORKDIR /app
COPY McAdminConsole/package.json McAdminConsole/bun.lock ./
RUN bun install --frozen-lockfile
COPY McAdminConsole/ .
RUN bun run build            # -> dist/ (Vite) or out/ (Next export)

# ---- option 1: Bun static server ----
FROM oven/bun:1.4-alpine
COPY --from=web /app/dist /srv/dist
COPY McAdminConsole/serve.ts /srv/serve.ts
ENV MCADMIN_BACKEND_URL=same-origin MCADMIN_WORKER_URL=http://worker:8000
CMD ["bun", "/srv/serve.ts"]

# ---- option 2 (single container): copy /app/dist into the Rust worker image
#      and let Axum serve it with ServeDir.
```

Rough final image sizes: Next standalone (Node + `.next/standalone`) is about 150–250 MB. Bun-alpine + `dist` is about 100 MB. nginx/Caddy-alpine + `dist` is about 25–50 MB. Bundled into the worker image, the frontend adds about 2–5 MB.

---

## 5. Options compared

### A. Next.js static export (`output: "export"`)
**What changes**
- `next.config.ts`: `output: "export"` (drop `standalone`; `allowedDevOrigins` stays for dev).
- The 8 `redirect()` stubs become client components with `useEffect(() => router.replace(...))`, or get deleted. The legacy `/dashboard/console` etc. stubs look obsolete.
- `[uuid]` layout becomes a client component.
- **Dynamic `[uuid]` workaround**, pick one:
  1. **Query param:** `/dashboard/instance/overview?id=<uuid>`. Works on any static host, but **changes every instance URL** and every `Link`/`router.push` that builds one (`server-grid.tsx`, `create-instance-dialog.tsx`, `dashboard-client-layout.tsx`, `files-tab.tsx`), and conflicts slightly with the files tab's own `?path=&edit=` params.
  2. **Placeholder param:** `generateStaticParams` returns `[{ uuid: "_" }]`, the host rewrites `/dashboard/*/x` to `/dashboard/_/x.html`, and the client reads the real UUID from `usePathname()`. Keeps URLs, but **needs custom rewrite rules on every host** and relies on undocumented export behaviour. Fragile.
- `bun run start` becomes `bun serve.ts out` (§4.2), since `next start` doesn't support export.

**Pros:** smallest code diff; keeps file-based routing, `next/font` and the familiar mental model; `bun run dev` is unchanged.
**Cons:** the `[uuid]` workaround is the weak point; you keep a heavy toolchain (Next + SWC/Turbopack, a 449 MB `.next`) whose main value (SSR, RSC, ISR, image optimisation) the app doesn't use; export mode has a growing list of unsupported features; tied to Next's fast major-version churn (13→16 changed routing and params semantics twice).
**Effort:** about half a day to one day.

### B. Vite + React Router v7, SPA / declarative mode **(recommended)**
**What changes**
- New `index.html`, `vite.config.ts` (`@vitejs/plugin-react`, `@tailwindcss/vite`, `@/` alias), `src/main.tsx` with a route tree mirroring `app/`:
  ```
  /                     -> app/page.tsx
  /serverstatus         -> app/serverstatus/page.tsx
  /manageuser           -> app/manageuser/page.tsx
  /dashboard            -> DashboardLayout (auth guard) > index (server grid)
  /dashboard/:uuid      -> InstanceLayout (DashboardProvider) > index => <Navigate to="overview">
     overview | console | content | files | players | properties | whitelist | admins
  /dashboard/{console,…} -> <Navigate to="/dashboard">   (legacy stubs)
  ```
- Mechanical swaps across the 20 files: `next/link` becomes `react-router` `Link` (`href` to `to`); `useRouter().push/replace` becomes `useNavigate()`; `usePathname` becomes `useLocation().pathname`; the `[uuid]` layout's `params` becomes `useParams()`.
- `next/font/google` becomes `@fontsource-variable/inter` / `geist` imports (self-hosted, offline builds); `Metadata` becomes `<title>` in `index.html`.
- `process.env.NODE_ENV` becomes `import.meta.env.DEV`; `NEXT_PUBLIC_BACKEND_URL` becomes `VITE_BACKEND_URL` (dev fallback only, see §4.1).
- `components.json` (shadcn): set `rsc: false`; `"use client"` directives become harmless no-ops and can be removed later.
- Scripts: `dev: "vite"`, `build: "vite build"`, `preview`/`start: "bun serve.ts"`. All run under Bun (`bun run dev` runs Vite on Bun).
- Dev-time `/api` proxy in `vite.config.ts` (`server.proxy` with `ws: true`) gives same-origin in dev too.

**Pros:**
- Dynamic `:uuid` routes are native. **URLs stay identical**, and the only host requirement is "fall back to `index.html`", which every server supports.
- Small, fast toolchain: HMR in milliseconds, production build in seconds, `dist/` of a few MB.
- shadcn, Tailwind 4, base-ui and lucide all support Vite first-class.
- No server-runtime concepts left to get wrong (no RSC boundaries, no params Promise).
- Code-splitting per route via `lazy` keeps the initial bundle small.
- Fits every hosting option in §4.3, including being embedded in the Rust worker.

**Cons:**
- One-off migration across about 20 files plus a new route file.
- Lose file-based routing (unless you choose D or C's file-router plugin).
- Lose Next conveniences you don't currently rely on (`next/image`, SSR/SEO, which doesn't matter for an authenticated admin panel).

**Effort:** about 1–2 days including testing. Most of it is mechanical find-and-replace.

### C. Vite + TanStack Router
Same build and hosting story as B. Adds **fully type-safe routes and search params**, with optional file-based routing via its Vite plugin.
**Pros:** typed `?path=&edit=` for the files tab; typed `:uuid`; built-in loaders and pending states; file-based routing closer to the Next feel.
**Cons:** steeper learning curve, more generated code (`routeTree.gen.ts`), smaller community than React Router.
**Effort:** about 2–3 days. A good choice if you value type safety over familiarity.

### D. React Router v7 framework mode with `ssr: false`
The Remix-style setup. File-based (`app/routes.ts`) routing, and `react-router build` with `ssr: false` emits a static SPA plus optional pre-rendered routes.
**Pros:** conventions close to Next's `app/` folder; can pre-render the few static pages; can add SSR later.
**Cons:** more framework machinery than this app needs; its own dev server and build pipeline; slightly more config for the SPA fallback.
**Effort:** about 2 days.

### E. Bun's native bundler (HTML imports + `Bun.serve` dev/HMR)
Bun 1.2+ can serve `index.html` imports with built-in bundling and HMR, so no Vite is needed.
**Pros:** the purest "just Bun" stack: one binary for install, dev, build, serve and test; fewest dependencies.
**Cons:** the ecosystem is younger (Tailwind needs `bun-plugin-tailwind`; fewer plugins; HMR edge cases); you still need a client router (React Router declarative); less community knowledge for debugging build issues.
**Effort:** about 1.5–2.5 days. Worth revisiting later; Vite on Bun is the lower-risk path today, and moving from B to E later is easy since the app code stays the same.

### F. Astro
Astro is a content-first, multi-page framework that ships zero JS by default and hydrates "islands".
**Why it doesn't fit McAdminConsole:**
- The app is **one stateful dashboard**: a shared `AuthProvider`, a `DashboardProvider` holding the WebSocket, logs, metrics history and permissions across tabs. Astro's MPA model reloads the page on navigation, dropping that state and reconnecting the WebSocket on every tab switch, unless you wrap the whole app in a single `client:only="react"` island with a client router inside it. At that point Astro is just a slower Vite wrapper.
- **Dynamic `[uuid]` pages** in Astro static mode also need `getStaticPaths` at build time. That's the same blocker as Next, so you'd need SSR (an adapter + server) or the client-router island again.
- Every page is authenticated and nothing benefits from Astro's real strengths (SEO, content collections, zero-JS pages).
**Where Astro would make sense:** a public marketing/docs site for McAdmin sitting next to the panel.
**Verdict:** adds complexity and solves none of the actual problems. Not recommended.

### G. SvelteKit (`adapter-static`) / SolidStart / Vue + Vite
All produce excellent static SPAs with fallback pages, and Svelte/Solid ship smaller runtimes.
**Why not:** they require **rewriting about 9.6k lines of React/TSX** and dropping shadcn/base-ui React components. That's a big rewrite for, at best, tens of KB of bundle savings on an admin panel. Not justified.

---

## 6. Comparison matrix

| Criterion | A. Next export | **B. Vite + RR** | C. Vite + TanStack | D. RR framework SPA | E. Bun bundler | F. Astro | G. Svelte/Solid |
|---|---|---|---|---|---|---|---|
| Static output | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/dashboard/:uuid` without hacks | ❌ (query param or rewrites) | ✅ | ✅ | ✅ | ✅ | ❌ (island or SSR) | ✅ |
| URLs unchanged | ⚠️ only with rewrites | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| State kept across tabs (WS) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ only as one island | ✅ |
| Dev HMR speed | Good (Turbopack) | Excellent | Excellent | Very good | Very good | Good | Excellent |
| Build speed / output size | Slow / medium | Fast / small | Fast / small | Fast / small | Fastest / small | Medium / small | Fast / smallest |
| Toolchain weight | Heavy | Light | Light | Medium | Lightest | Medium | Light |
| Runs on Bun | ✅ | ✅ | ✅ | ✅ | ✅ native | ✅ | ✅ |
| shadcn / Tailwind 4 support | ✅ | ✅ | ✅ | ✅ | ⚠️ plugin | ✅ | ⚠️ ports only |
| Migration effort | ~0.5–1 d | ~1–2 d | ~2–3 d | ~2 d | ~1.5–2.5 d | ~3+ d | rewrite (weeks) |
| Lock-in / churn risk | High | Low | Low–med | Medium | Medium (young) | Medium | — |
| **Overall fit** | OK | **Best** | Very good | Good | Good (later) | Poor | Poor |

---

## 7. Recommended roadmap (for when you implement it)

Each phase can ship on its own and keeps `bun run dev` working.

1. **Runtime config** (framework-independent, about 1–2 h)
   - Add `public/config.js` and load it in the root layout `<head>`; update `getBackendBaseUrl()` per §4.1 (`"same-origin"` maps to `location.origin`).
   - ✅ Check: existing `.env` dev setup still works; editing `config.js` changes the backend without rebuilding.
2. **Bun static server** (about 1–2 h)
   - Add `serve.ts` (static + SPA fallback + `/config.js` from env + optional `/api` + WS proxy).
   - ✅ Check: deep link `/dashboard/<uuid>/console` loads and streams logs through the proxy.
3. **Framework move** (Option B, about 1–2 days; or Option A, about 0.5–1 day)
   - B: add Vite config + `index.html` + route tree, swap Next imports, swap fonts, update scripts (`dev`, `build`, `start`), remove `next.config.ts`, `next-env.d.ts`, `eslint-config-next`.
   - ✅ Check: every tab works (overview metrics, console WS, content/Modrinth installs, files upload/edit/delete, players, whitelist, properties, admins), plus login/register/first-run, `/manageuser`, redirects for the legacy `/dashboard/<tab>` paths, and browser back/forward and refresh on deep links.
4. **Update `start.sh`**: prod mode runs `bun run build && bun run start`.
5. **Dockerfile + compose** (§4.4): worker + frontend (or a single image with the worker serving `dist/`), with `MCADMIN_BACKEND_URL` / `MCADMIN_WORKER_URL` env.
6. *(Optional)* Add the `fs` feature to `tower-http` and `ServeDir` in `McAdminWorker/src/main.rs` for a single-binary deploy.

---

## 8. Risks & open questions

- **Token in `localStorage` and in the WebSocket query string:** unchanged by any option. Same-origin hosting lets you later move to an `HttpOnly` cookie set by the worker (the worker already accepts the `mcadmin_token` cookie), which closes the XSS token-theft gap and keeps the token out of proxy access logs.
- **CORS:** the worker currently mirrors any origin **with credentials**. Fine for dev, but in a cross-origin production deployment restrict it to a configured origin list. With same-origin hosting it becomes irrelevant.
- **Caching:** hashed assets can be `immutable`; `index.html` and `config.js` must be `no-cache`, or upgrades and config changes won't show up.
- **Large uploads (up to 1 GB):** if `/api` goes through a proxy (Bun, nginx, Caddy), raise body-size limits and timeouts (nginx `client_max_body_size`, Bun `maxRequestBodySize`).
- **WebSocket through proxies:** needs the upgrade headers forwarded (nginx `proxy_set_header Upgrade/Connection`; Caddy handles it automatically).
- **Mock/no-backend mode:** keep "empty base URL means mock" semantics distinct from "same-origin" (§2.2 trap).
- **Stale `.next` in prod:** `start.sh` currently skips the build. Any new setup should build explicitly (or in Docker).
- **Open question:** should the frontend ship as its own container or inside the worker? A single container is simplest for self-hosters. Separate containers allow independent frontend releases and a CDN.
