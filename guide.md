# Project Guide

> **IMPORTANT:** Always keep this file updated whenever you add, remove, or modify any route, package, file, or behaviour. Other agents and developers rely on this as the source of truth.

---

## What This Project Is

A YouTube video/audio proxy API. Clients submit a YouTube URL and receive clean JSON with self-hosted stream URLs. The server resolves format selection via `yt-dlp` at request time — YouTube's short-lived CDN URLs are never exposed to clients.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 |
| Framework | Express 5 |
| Process manager | pnpm workspaces |
| Video extraction | yt-dlp (Python CLI) |
| Logging | pino + pino-http |
| Build | esbuild (CJS → ESM bundle) |

---

## Repository Layout

```
artifacts/
  api-server/          # Main Express API (the only deployed service)
    src/
      app.ts           # Express app setup (cors, logging, routes)
      index.ts         # Entrypoint — reads PORT env var, starts server
      lib/
        logger.ts      # Singleton pino logger
      routes/
        index.ts       # Mounts all sub-routers
        health.ts      # GET /api/healthz
        youtube.ts     # GET /api/info  /api/video  /api/audio
lib/                   # Shared TypeScript libraries (workspace packages)
scripts/               # Utility scripts
guide.md               # ← this file
```

---

## API Endpoints

### `GET /api/healthz`
Health check.

**Response:**
```json
{ "status": "ok" }
```

---

### `GET /api/info?url=<youtube_url>`
Extracts video metadata. Returns one MP4 entry per resolution (deduplicated) and a best-audio entry. All URLs point back to this server — no YouTube CDN URLs exposed.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `url` | ✅ | Any public YouTube URL (full or short) |

**Response:**
```json
{
  "id": "vBynw9Isr28",
  "title": "Lady Gaga - Abracadabra (Official Music Video)",
  "qualities": [
    { "quality": "144p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=144p" },
    { "quality": "240p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=240p" },
    { "quality": "360p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=360p" },
    { "quality": "480p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=480p" },
    { "quality": "720p",  "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=720p" },
    { "quality": "1080p", "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=1080p" },
    { "quality": "1440p", "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=1440p" },
    { "quality": "2160p", "url": "https://your-domain/api/video?id=vBynw9Isr28&quality=2160p" }
  ],
  "audio": {
    "format": "m4a",
    "url": "https://your-domain/api/audio?id=vBynw9Isr28"
  }
}
```

---

### `GET /api/video?id=<video_id>&quality=<height>p`
Streams the best MP4 at the requested resolution, inline in the browser. `yt-dlp` re-resolves the format at request time.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `id` | ✅ | YouTube video ID (e.g. `vBynw9Isr28`) |
| `quality` | ✅ | Resolution string (e.g. `720p`, `1080p`) |

**Response headers:**
```
Content-Type: video/mp4
Content-Disposition: inline; filename="<id>_<quality>.mp4"
```

---

### `GET /api/audio?id=<video_id>`
Streams the best available audio track (prefers m4a) inline.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `id` | ✅ | YouTube video ID |

**Response headers:**
```
Content-Type: audio/mp4
Content-Disposition: inline; filename="<id>_audio.m4a"
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | ✅ | — | Port the Express server listens on |
| `YT_DLP_PATH` | ❌ | `yt-dlp` (PATH) | Absolute path to the `yt-dlp` binary |
| `SESSION_SECRET` | ❌ | — | Reserved for future session/auth use |

---

## Changelog

### 2026-06-22 — Initial build
- Bootstrapped Express 5 API server in `artifacts/api-server`
- Added `GET /api/healthz`

### 2026-06-22 — YouTube proxy API (v1)
- Added `GET /api/info` — dumps all video/audio formats via `yt-dlp --dump-json`
- Added `GET /api/stream` — streams any format by raw `fmtid` (internal YouTube format ID)
- `yt-dlp` installed via pip: `pip install -U yt-dlp`

### 2026-06-22 — YouTube proxy API (v2, current)
- **`/api/stream` replaced** by `/api/video?id=&quality=` and `/api/audio?id=`
- `/api/info` now deduplicates qualities (one MP4 per resolution only, WebM removed)
- Format selection uses yt-dlp format strings (`bestvideo[height=N][ext=mp4]`) — no fmtid exposed to clients
- `Content-Disposition: inline` so browsers play video/audio rather than download it
- `YT_DLP_PATH` env var added for portable deployment (falls back to `yt-dlp` on PATH)
- Client disconnect kills the yt-dlp subprocess via `SIGTERM` (prevents process leaks)

---

## Deploying to Render.com

### Service type
**Web Service** — Render's free/paid web service tier works fine.

### Build command
```bash
pip install -U yt-dlp && npm install -g pnpm@10 && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build
```

### Start command
```bash
node artifacts/api-server/dist/index.mjs
```

### Environment variables to set in Render dashboard
| Key | Value |
|---|---|
| `PORT` | `10000` (Render's default injected port — set this or Render injects it automatically) |
| `YT_DLP_PATH` | `/opt/render/.local/bin/yt-dlp` *(verify after first deploy with a shell session)* |
| `NODE_ENV` | `production` |

### Notes for Render
- The build command installs Python (`yt-dlp`) first, then installs pnpm and Node deps.
- Render sets `PORT` automatically on web services — the app reads it from `process.env.PORT`.
- If `yt-dlp` is not found at startup, set `YT_DLP_PATH` to the output of `which yt-dlp` in a Render shell session.
- Render's free tier **sleeps after inactivity** — first request after sleep will be slow while yt-dlp starts.
- Each `/api/video` or `/api/audio` request spawns a `yt-dlp` subprocess. On free tier, concurrent streams may hit CPU limits.

---

## Local Development

```bash
# Install dependencies
pnpm install

# Install yt-dlp (Python must be available)
pip install -U yt-dlp

# Start the API server (workflow handles PORT automatically in Replit)
pnpm --filter @workspace/api-server run dev

# Typecheck
pnpm --filter @workspace/api-server run typecheck

# Full workspace typecheck
pnpm run typecheck
```

---

## Rules for Future Agents

1. **Update this file** every time you add a route, change a route signature, install a package, or change build/start commands.
2. **Never expose YouTube CDN URLs** to clients — always proxy through `/api/video` or `/api/audio`.
3. **Always kill child processes** on client disconnect (`req.on("close", () => proc.kill("SIGTERM"))`).
4. **Use `req.log`** for logging inside route handlers, never `console.log`.
5. **Test with `curl localhost:80/api/...`** — the shared proxy routes through port 80 in Replit.
6. Keep Render.com compatibility: use `process.env.YT_DLP_PATH || "yt-dlp"` so the binary path is configurable.
