# Project Guide

> **IMPORTANT:** Always keep this file updated whenever you add, remove, or modify any route, package, file, or behaviour. Other agents and developers rely on this as the source of truth.

---

## What This Project Is

A YouTube video/audio proxy API. Clients submit a YouTube URL and receive clean JSON with self-hosted stream URLs. The server downloads and caches videos via `yt-dlp` + `ffmpeg`, then serves them with full HTTP Range support — YouTube's short-lived CDN URLs are never exposed to clients.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 |
| Framework | Express 5 |
| Process manager | pnpm workspaces |
| Video extraction + merge | yt-dlp (Python CLI) + ffmpeg |
| Logging | pino + pino-http |
| Build | esbuild (ESM bundle) |

---

## Repository Layout

```
artifacts/
  api-server/          # Main Express API (the only deployed service)
    src/
      app.ts           # Express setup: cors, logging, routes, 404, error handler
      index.ts         # Entrypoint: PORT, graceful shutdown, uncaughtException
      lib/
        logger.ts      # Singleton pino logger
        stats.ts       # Request counter + getStats() — uptime, req/s, memory, load
      routes/
        index.ts       # Mounts all sub-routers
        health.ts      # GET /api/healthz
        stats.ts       # GET /api/stats
        youtube.ts     # GET /api/info  /api/video  /api/audio  + shutdown()
        dashboard.ts   # GET / — live HTML dashboard
lib/                   # Shared TypeScript libraries (workspace packages)
scripts/               # Utility scripts
guide.md               # ← this file
```

### Cache directory

`/tmp/ytcache/` (overridable via `CACHE_DIR` env var). Contains:

| File | Description |
|---|---|
| `<id>_<quality>.mp4` | Fully muxed video + audio |
| `<id>_audio.m4a` | Best audio track |
| `<id>.title` | Plain-text video title (tiny, avoids repeat yt-dlp calls) |

Files are evicted after `CACHE_TTL_MINUTES` (default 30 min) of inactivity. Cleanup runs every `CLEANUP_INTERVAL_MINUTES` (default 10 min). `/tmp/` is ephemeral — clears on server restart.

---

## API Endpoints

All JSON responses follow a standard envelope:

**Success**
```json
{ "status": 200, "success": true, "message": "...", "data": { ... } }
```

**Error**
```json
{ "status": 400, "success": false, "message": "..." }
```

Streaming endpoints (`/api/video`, `/api/audio`) return binary data on success; the envelope is only used for errors.

---

### `GET /`

Live HTML dashboard — auto-refreshes every second. Shows:
- Current time in the visitor's local timezone
- Server uptime, requests/second (10 s window), total requests
- Heap / RSS memory, load average, CPU count
- Node.js version, platform, environment
- Clickable links to all API endpoints

---

### `GET /api/healthz`

```json
{ "status": "ok" }
```

---

### `GET /api/stats`

Live server metrics. No params.

```json
{
  "uptime": 120,
  "uptimeHuman": "2m 0s",
  "totalRequests": 42,
  "requestsPerSecond": 0.5,
  "nodeVersion": "v24.13.0",
  "platform": "linux",
  "arch": "x64",
  "env": "production",
  "memoryMB": { "rss": 98, "heapUsed": 15, "heapTotal": 22 },
  "cpus": 4,
  "loadAvg": [0.78, 0.34, 0.14]
}
```

---

### `GET /api/info?url=<youtube_url>`

Extracts video metadata. Returns one MP4 per resolution (deduplicated), thumbnail, and best audio. All stream URLs point to this server.

| Param | Required | Notes |
|---|---|---|
| `url` | ✅ | Any public YouTube URL (`youtube.com` or `youtu.be`) |

**Success:**
```json
{
  "status": 200, "success": true,
  "message": "Video information retrieved successfully.",
  "data": {
    "id": "vBynw9Isr28",
    "title": "Lady Gaga - Abracadabra (Official Music Video)",
    "thumbnail": "https://i.ytimg.com/vi/vBynw9Isr28/maxresdefault.jpg",
    "qualities": [
      { "quality": "144p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=144p" },
      { "quality": "360p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=360p" },
      { "quality": "720p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=720p" },
      { "quality": "1080p", "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=1080p" }
    ],
    "audio": { "format": "m4a", "url": "https://your-domain/api/audio?id=vBynw9Isr28" }
  }
}
```

**Errors:** `400` bad param, `404` video unavailable/private, `502` yt-dlp failure

---

### `GET /api/video?id=<video_id>&quality=<height>p`

Downloads on first request (video + audio merged via ffmpeg), caches to `/tmp/ytcache/<id>_<quality>.mp4`, then serves. Full `206 Partial Content` support — browsers and HTML5 players can seek freely.

| Param | Required | Notes |
|---|---|---|
| `id` | ✅ | 11-char YouTube video ID |
| `quality` | ✅ | e.g. `360p`, `1080p` |

**Response headers (success):**
```
HTTP 200 / 206
Content-Type: video/mp4
Content-Disposition: inline; filename="Lady Gaga - Abracadabra [360p].mp4"
Accept-Ranges: bytes
Content-Length: <bytes>
Content-Range: bytes <start>-<end>/<total>   ← 206 only
Cache-Control: public, max-age=3600
```

**yt-dlp format string:**
```
bestvideo[height=N][ext=mp4]+bestaudio[ext=m4a]
/bestvideo[height=N][ext=mp4]+bestaudio
/best[height<=N][ext=mp4]
```

**Errors:** `400` bad params, `416` bad Range, `502` download failed

---

### `GET /api/audio?id=<video_id>`

Same pattern as `/api/video` — downloads, caches, serves with Range support.

| Param | Required |
|---|---|
| `id` | ✅ |

```
Content-Type: audio/mp4
Content-Disposition: inline; filename="Lady Gaga - Abracadabra.m4a"
```

**Errors:** `400` bad ID, `502` download failed

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | ✅ | — | Express listen port |
| `YT_DLP_PATH` | ❌ | `yt-dlp` | Absolute path to yt-dlp binary |
| `CACHE_DIR` | ❌ | `/tmp/ytcache` | Where to store downloaded files |
| `CACHE_TTL_MINUTES` | ❌ | `30` | Minutes before an unaccessed file is deleted |
| `CLEANUP_INTERVAL_MINUTES` | ❌ | `10` | How often to run cache eviction |
| `MAX_CONCURRENT_DOWNLOADS` | ❌ | `3` | Max simultaneous yt-dlp download processes |
| `NODE_ENV` | ❌ | `development` | Set to `production` on Render |
| `SESSION_SECRET` | ❌ | — | Reserved for future auth use |

---

---

## POT Server (`artifacts/pot-server`)

A lightweight, standalone Express service that generates YouTube **Proof of Origin Tokens (PO tokens)** on demand and caches them — required to let yt-dlp bypass YouTube's bot detection on server/datacenter IPs.

### Why a separate service?

The main api-server spawns yt-dlp processes. The POT server is a _stateless, side-car service_: yt-dlp calls it via `--extractor-args "youtube:pot=http://your-pot-server/get_pot"` to get fresh tokens. Keeping them separate means the memory-hungry token generation (jsdom + YouTube JS eval) doesn't compete with ffmpeg on the same instance.

### Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 (ESM, no build step, `--max-old-space-size=768`) |
| Framework | Express 5 |
| Token generation | `youtube-po-token-generator` v0.6 (jsdom-based, no headless browser) |

> **Note on `bgutil-ytdlp-pot-provider`:** that npm package is not available through the Replit/npm registry firewall. `youtube-po-token-generator` is the registry-available equivalent — it generates the same `poToken + visitorData` pair using jsdom instead of Puppeteer/full headless Chrome.

> **Memory reality:** Running YouTube's botguard JavaScript through jsdom requires **500 MB – 1 GB of heap** for the initial generation. After the first token is cached, subsequent requests are instant and use almost no memory. This means the POT server needs a dedicated instance with at least **1 GB RAM** — it cannot share an instance with the api-server (ffmpeg + yt-dlp) without OOM risk.
>
> In Replit's shared dev environment, the POT server workflow will start successfully but the first `/get_pot` call will take 30–60 s and may OOM if the api-server is also running. **Treat this as a Render-only service in production.** Token generation does NOT warm up on startup — it is lazy (first request only) to prevent boot-time OOM.

### Repository layout

```
artifacts/pot-server/
  src/
    server.js     # Entire server — Express setup, token cache, routes
  package.json    # @workspace/pot-server — deps: express, youtube-po-token-generator
```

### API Endpoints

#### `GET /health`

```json
{ "status": "ok", "uptime": 42, "tokenCached": true, "cacheExpiresIn": 218 }
```

#### `GET /get_pot` or `POST /get_pot`

Returns a valid token pair. Served from cache if still fresh; regenerated otherwise.

```json
{ "po_token": "...", "visitor_data": "..." }
```

Errors return `HTTP 500` with `{"error": "Failed to generate PO token. Check server logs."}`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | Express listen port |
| `TOKEN_TTL_MS` | `300000` | Token cache TTL in milliseconds (default 5 min) |

### Caching design

- A single `{poToken, visitorData, expiresAt}` object is held in memory.
- On startup the server pre-warms the cache so the first real request is instant.
- Concurrent requests that arrive before the first token is ready share one in-flight generation promise — YouTube is never hammered with parallel calls.
- `TOKEN_TTL_MS` defaults to 5 minutes. YouTube botguard tokens expire after ~10 minutes; 5 minutes gives a safe margin.

### Local development

```bash
pnpm install
pnpm --filter @workspace/pot-server run dev   # listens on port 8000
curl localhost:8000/health
curl localhost:8000/get_pot
```

### Integrating with yt-dlp (main api-server)

Pass the token to yt-dlp via extractor args whenever calling it:

```
--extractor-args "youtube:pot=http://localhost:8000/get_pot"
```

Or set it in `/api/info` / `/api/video` / `/api/audio` by updating `spawnYtDlp()` in `youtube.ts` to append this flag when `POT_SERVER_URL` env var is set:

```
POT_SERVER_URL=https://your-pot-server.onrender.com
```

---

## Deploying the POT Server to Render.com

Deploy it as a **separate** Web Service from the main api-server — they run on different instances.

### Step-by-step

1. Render dashboard → **New → Web Service** → connect your GitHub repo
2. Set **Root Directory** to `artifacts/pot-server`
3. Render detects Node.js automatically. Fill in:

| Field | Value |
|---|---|
| **Runtime** | Node |
| **Build command** | `npm install --omit=dev` |
| **Start command** | `node src/server.js` |

4. Under **Environment**, add:

| Key | Value |
|---|---|
| `PORT` | _(leave blank — Render injects it)_ |
| `NODE_ENV` | `production` |
| `TOKEN_TTL_MS` | `300000` _(or adjust to taste)_ |

5. Choose instance type: **Starter (1 GB RAM) or higher** — the free tier (256 MB) will OOM during token generation. jsdom needs ~500 MB–1 GB of heap to execute YouTube's botguard JS on the first request. After the first token is cached, idle memory drops to ~100–150 MB.

6. Click **Deploy**.

### After deploy

Copy your service URL (e.g. `https://my-pot-server.onrender.com`) and set it as `POT_SERVER_URL` in your **main api-server** Render service. Then update `spawnYtDlp()` in `youtube.ts` to fetch and pass the token when that env var is present.

### Render notes

- **Free tier sleep** — after 15 min of inactivity Render spins down the service. The first request after wake-up triggers a fresh token generation (~3–8 s). Add a cron ping (`https://cron-job.org`) to keep it warm if needed.
- **No disk, no DB** — the POT server is entirely in-memory; no storage needed.
- **Health check** — Render will use `GET /health` to verify the service is alive (configure it in the service settings under Health & Alerts → Health Check Path = `/health`).

---

## Changelog

### 2026-06-22 — Initial build
- Bootstrapped Express 5 API server
- Added `GET /api/healthz`

### 2026-06-22 — YouTube proxy API v1
- `GET /api/info` — full format dump via `yt-dlp --dump-json`
- `GET /api/stream` — stream by raw `fmtid`
- `pip install -U yt-dlp`

### 2026-06-22 — YouTube proxy API v2
- `/api/stream` replaced by `/api/video` and `/api/audio`
- Deduplicated qualities (one MP4/resolution, no WebM)
- `YT_DLP_PATH` env var added

### 2026-06-22 — YouTube proxy API v3
- Thumbnail in `/api/info`
- Standard `{status,success,message,data}` envelope on all JSON
- HTTP Range / 206 Partial Content — seeking support
- Correct Content-Disposition filenames (YouTube title)
- Audio merged into every MP4 via ffmpeg
- Download lock map prevents duplicate processes

### 2026-06-22 — YouTube cookie authentication (current)
- Added `YT_COOKIES_BASE64` env var support: on startup the server decodes it and writes `/tmp/yt-cookies.txt`; `spawnYtDlp()` automatically adds `--cookies /tmp/yt-cookies.txt` when the file exists — required to bypass YouTube's bot detection on server/datacenter IPs
- Cookies are optional at the code level (file checked at call time); server starts fine without them

### 2026-06-22 — yt-dlp JS runtime fix
- Added `--js-runtimes node` to every yt-dlp spawn call via a `spawnYtDlp()` helper — Render (and any server without Deno) throws `No supported JavaScript runtime could be found` without this flag; Node.js is always present since we run on a Node runtime

### 2026-06-22 — pnpm build fix + endpoint table
- Fixed `[ERR_PNPM_IGNORED_BUILDS]`: `pnpm.yaml` is correct but `--frozen-lockfile` makes pnpm use only the lockfile's settings (which have no `onlyBuiltDependencies`), bypassing `pnpm.yaml` entirely. Fix: drop `--frozen-lockfile` and pin `pnpm@10.26.1` (exact version known to work) — pnpm then reads `pnpm.yaml` and allows esbuild to run its install script
- Replaced endpoint cards on dashboard with a full reference table: method, path, required params, description, live Try link
- Table is responsive (collapses on mobile)

### 2026-06-22 — Dashboard + stats
- `GET /` — live HTML dashboard: user timezone clock, uptime, req/s, memory, load, env, API links
- `GET /api/stats` — JSON metrics endpoint (uptime, req/s 10 s window, heap/RSS, load avg, CPUs)
- `src/lib/stats.ts` — singleton request counter with 60 s sliding window; `recordRequest()` + `getStats()`
- `src/routes/dashboard.ts` — self-contained HTML served inline from Express
- `src/routes/stats.ts` — thin wrapper around `getStats()`
- `recordRequest()` middleware added to `app.ts` before all routes
- Tested: `GET /api/info?url=https://youtu.be/vBynw9Isr28` returns 8 qualities (144p–2160p) + audio URL

### 2026-06-22 — Render.com deployment
- Added `render.yaml` blueprint — one-click deploy via New → Blueprint
- Added `.node-version` — pins Node 24 for Render
- Root `package.json` `build` script is the full self-contained pipeline: `pip install -U yt-dlp` → `npm install -g pnpm@latest` → `pnpm install` → esbuild compile
- Root `package.json` `start` script: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- Both fields **auto-fill** when using Render → New → Web Service (Render reads `package.json` scripts)
- `guide.md` rule added to `replit.md` user preferences — always keep guide updated

### 2026-06-22 — POT Server
- Added `artifacts/pot-server/` — standalone Express 5 service for Proof of Origin token generation
- Uses `youtube-po-token-generator` (jsdom-based) — equivalent to `bgutil-ytdlp-pot-provider` without headless Chrome
- Endpoints: `GET /health`, `GET /get_pot`, `POST /get_pot`
- Token cache with configurable TTL (`TOKEN_TTL_MS`, default 5 min); concurrent requests share one in-flight generation promise
- Lazy token generation (no startup warm-up) to prevent boot-time OOM
- `--max-old-space-size=768` flag on the Node process to cap heap and surface OOM clearly
- Deploy as a **separate** Render Web Service (Root Directory: `artifacts/pot-server`); requires Starter (1 GB RAM) instance
- `PORT` and `TOKEN_TTL_MS` are the only env vars needed

### 2026-06-22 — Production hardening v4
- **Semaphore** — max `MAX_CONCURRENT_DOWNLOADS` (default 3) concurrent yt-dlp processes; additional requests queue
- **TTL cache eviction** — `lastAccess` tracked per file; cleanup timer deletes stale `.mp4`/`.m4a` files every 10 min
- **Partial file cleanup** — failed downloads delete their incomplete output file immediately
- **Graceful shutdown** — `SIGTERM`/`SIGINT` kill active yt-dlp processes, close HTTP server, then exit; 15 s forced-exit safety net
- **uncaughtException / unhandledRejection** handlers in `index.ts`
- **Title fetch lock** — concurrent `/api/video` calls for the same ID share one `--print title` process
- **Video ID validation** — regex `^[a-zA-Z0-9_-]{11}$` rejects garbage before hitting yt-dlp
- **YouTube URL guard** in `/api/info` — rejects non-YouTube URLs with 400 before spawning yt-dlp
- **Robust Range parsing** — handles NaN, clamps end to `fileSize-1`, returns 416 on malformed header
- **File stream error handling** — read stream errors don't crash the process
- **`Cache-Control: public, max-age=3600`** on served files — CDN and browser caching friendly
- **404 handler** in `app.ts` — unknown routes return standard envelope
- **Global Express error handler** — async route errors caught, stack traces never sent to clients
- **`--no-warnings`** flag on download calls — suppresses JS runtime noise in logs
- **Proto fix for Render.com** — `x-forwarded-proto: https,http` handled by splitting on `,`
- **`CACHE_DIR` env var** — cache location configurable for non-tmp deployments

---

## Deploying to Render.com

### Runtime: Node.js (correct — not Python)

The app is an Express/Node.js server. **Python is only used during the build step** to install `yt-dlp` as a command-line tool. Render will correctly detect this as a Node.js service — that is expected.

---

### Method 1 — New Web Service (commands auto-fill)

1. Render dashboard → **New → Web Service** → connect repo
2. Render detects Node.js and **auto-fills** build and start from `package.json`:

| Field | Auto-filled value |
|---|---|
| **Build command** | `npm run build` |
| **Start command** | `npm start` |

`npm run build` runs the full self-contained pipeline:
```
pip install -U yt-dlp  →  npm install -g pnpm@latest  →  pnpm install  →  esbuild compile
```

No manual copy-paste needed.

---

### Method 2 — Blueprint (one-click via render.yaml)

Render dashboard → **New → Blueprint** → connect repo → Render reads `render.yaml` automatically.

---

### Environment variables (set in Render dashboard)

| Key | Value |
|---|---|
| `PORT` | Injected automatically by Render — do **not** set manually |
| `NODE_ENV` | `production` (already set in `render.yaml`) |
| `DATABASE_URL` | Your Postgres connection string |
| `YT_DLP_PATH` | Leave **unset** — `yt-dlp` is on PATH after the build step |
| `MAX_CONCURRENT_DOWNLOADS` | `2` (conservative for free tier) |
| `CACHE_TTL_MINUTES` | `20` (shorter on free tier — less disk pressure) |

---

### Files added for Render

| File | Purpose |
|---|---|
| `render.yaml` | Blueprint — defines runtime, build command, start command, env vars |
| `.node-version` | Pins Node 24 so Render uses the correct runtime |

### Render notes

- **ffmpeg** — pre-installed on Render's standard image. If missing: prepend `apt-get install -y ffmpeg &&` to the build script in `package.json`.
- **yt-dlp** — installed via `pip install -U yt-dlp` inside `npm run build`; no manual setup.
- **Disk** — `/tmp/ytcache/` is ephemeral. First request after a restart triggers a fresh download.
- **Free tier sleep** — first request after inactivity is slow (yt-dlp + ffmpeg merge). Consider a cron ping for uptime.
- **Graceful shutdown** — Render sends `SIGTERM`; the server drains yt-dlp processes and closes within 15 s.

---

## Local Development

```bash
pnpm install
pip install -U yt-dlp

# ffmpeg — must be installed separately:
# macOS:   brew install ffmpeg
# Ubuntu:  apt-get install -y ffmpeg
# Replit/Nix: already available

pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/api-server run typecheck
pnpm run typecheck
```

---

## Rules for Future Agents

1. **Update this file** every time you add a route, change a signature, install a package, or change build/start commands.
2. **Never expose YouTube CDN URLs** — always proxy through `/api/video` or `/api/audio`.
3. **Use the standard envelope** `{status, success, message, data}` for all JSON. Streaming endpoints only use it for errors.
4. **Use `req.log`** in route handlers. Never `console.log`.
5. **Test with `curl localhost:80/api/...`** — the shared Replit proxy routes through port 80.
6. **Keep Render.com compatibility** — `process.env.YT_DLP_PATH || "yt-dlp"` and `process.env.CACHE_DIR || "/tmp/ytcache"`.
7. **Never remove the semaphore or download lock map** — they prevent resource exhaustion under concurrent load.
8. **Treat non-empty output file as success** even if yt-dlp exits non-zero — the JS runtime warning causes spurious non-zero exits.
9. **Export `shutdown()`** from `youtube.ts` and call it from `index.ts` on `SIGTERM`/`SIGINT`.
10. **Do not add `console.log` or expose `err.stack`** to API responses — use `req.log.error` and return a generic message.
