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

### Cache directory

`/tmp/ytcache/` — created at startup. Contains:
- `<id>_<quality>.mp4` — merged video+audio files
- `<id>_audio.m4a` — best audio files
- `<id>.title` — plain-text title cache (prevents redundant yt-dlp calls)

Files in `/tmp/` are cleared on server restart. This is intentional — Render.com and Replit ephemeral storage is fine for caching.

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

---

### `GET /api/healthz`
Health check.

**Response:**
```json
{ "status": "ok" }
```

---

### `GET /api/info?url=<youtube_url>`
Extracts video metadata. Returns one MP4 entry per resolution (deduplicated, no WebM), a thumbnail URL, and best audio. All stream URLs point back to this server — no YouTube CDN URLs exposed. Also caches the video title to `/tmp/ytcache/<id>.title` to speed up subsequent `/api/video` and `/api/audio` requests.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `url` | ✅ | Any public YouTube URL (full or short) |

**Success response:**
```json
{
  "status": 200,
  "success": true,
  "message": "Video information retrieved successfully.",
  "data": {
    "id": "vBynw9Isr28",
    "title": "Lady Gaga - Abracadabra (Official Music Video)",
    "thumbnail": "https://i.ytimg.com/vi/vBynw9Isr28/maxresdefault.jpg",
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
}
```

**Error responses:**
- `400` — missing `url` param
- `404` — video unavailable or private
- `502` — yt-dlp failed for another reason

---

### `GET /api/video?id=<video_id>&quality=<height>p`

Downloads (on first request) a fully muxed MP4 — video stream merged with the best available audio via ffmpeg — and caches it to `/tmp/ytcache/<id>_<quality>.mp4`. Subsequent requests are served directly from cache.

Supports **HTTP Range requests** (`206 Partial Content`) so browsers and HTML5 `<video>` players can seek to any timestamp.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `id` | ✅ | YouTube video ID (e.g. `vBynw9Isr28`) |
| `quality` | ✅ | Resolution string (e.g. `720p`, `1080p`) |

**Response headers (success):**
```
HTTP 200 (full) or 206 (range)
Content-Type: video/mp4
Content-Disposition: inline; filename="Lady Gaga - Abracadabra (Official Music Video) [360p].mp4"
Accept-Ranges: bytes
Content-Range: bytes <start>-<end>/<total>   ← only on 206
```

**yt-dlp format string used:**
```
bestvideo[height=N][ext=mp4]+bestaudio[ext=m4a]
/bestvideo[height=N][ext=mp4]+bestaudio
/best[height<=N][ext=mp4]
```

**Error responses:**
- `400` — missing or invalid `id` / `quality` param
- `416` — Range Not Satisfiable
- `502` — download failed

---

### `GET /api/audio?id=<video_id>`

Downloads (on first request) the best available audio track (prefers m4a) and caches it to `/tmp/ytcache/<id>_audio.m4a`. Supports HTTP Range requests.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `id` | ✅ | YouTube video ID |

**Response headers (success):**
```
HTTP 200 or 206
Content-Type: audio/mp4
Content-Disposition: inline; filename="Lady Gaga - Abracadabra (Official Music Video).m4a"
Accept-Ranges: bytes
```

**Error responses:**
- `400` — missing `id`
- `502` — download failed

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

### 2026-06-22 — YouTube proxy API (v2)
- **`/api/stream` replaced** by `/api/video?id=&quality=` and `/api/audio?id=`
- `/api/info` deduplicates qualities (one MP4 per resolution, WebM removed)
- Format selection uses yt-dlp format strings — no YouTube format IDs exposed to clients
- `YT_DLP_PATH` env var added for portable deployment

### 2026-06-22 — YouTube proxy API (v3, current)
- **Thumbnail** added to `/api/info` response (`https://i.ytimg.com/vi/<id>/maxresdefault.jpg`)
- **Standard response envelope** `{ status, success, message, data }` on all JSON responses
- **HTTP Range requests** (206 Partial Content) — full seeking support in HTML5 players. Videos are downloaded to `/tmp/ytcache/` first, then served from disk with range support
- **Correct filenames** — `Content-Disposition` uses the actual YouTube video title (e.g. `Lady Gaga - Abracadabra (Official Music Video) [360p].mp4`)
- **Audio merged into every MP4** — `bestvideo+bestaudio --merge-output-format mp4` via ffmpeg; video-only tracks are always combined with audio before serving
- **Download lock map** — concurrent requests for the same file share one download promise, no duplicate processes
- **Exit-code resilience** — yt-dlp may exit non-zero due to JS runtime warnings; a non-empty output file is treated as success regardless of exit code
- **Title cache** — `/tmp/ytcache/<id>.title` avoids repeated `--print title` calls

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
| `PORT` | `10000` (Render injects this automatically for web services) |
| `YT_DLP_PATH` | `/opt/render/.local/bin/yt-dlp` *(verify with `which yt-dlp` in a Render shell after first deploy)* |
| `NODE_ENV` | `production` |

### Notes for Render
- `ffmpeg` must be available on the Render instance. It is pre-installed on Render's standard Docker images. If missing, add `apt-get install -y ffmpeg` to the build command.
- `/tmp/ytcache/` is ephemeral — it is recreated on every server restart (Render cold starts). Cached files are lost between deploys; the first request per video+quality will trigger a fresh download.
- Render's free tier **sleeps after inactivity** — first request after wake-up will be slow while yt-dlp downloads and merges the video.
- Concurrent high-quality video downloads are CPU-intensive. Free tier may time out on 1080p+ merges.

---

## Local Development

```bash
# Install Node dependencies
pnpm install

# Install yt-dlp (requires Python 3)
pip install -U yt-dlp

# ffmpeg must be installed separately
# macOS:   brew install ffmpeg
# Ubuntu:  apt-get install -y ffmpeg
# Replit/Nix: already available

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
3. **Always use the standard response envelope** `{ status, success, message, data }` for all JSON responses. Streaming endpoints (video/audio) use this only for error responses.
4. **Use `req.log`** for logging inside route handlers, never `console.log`.
5. **Test with `curl localhost:80/api/...`** — the shared proxy routes through port 80 in Replit.
6. **Keep Render.com compatibility**: use `process.env.YT_DLP_PATH || "yt-dlp"` so the binary path is configurable.
7. **Do not remove the download lock map** — it prevents duplicate concurrent yt-dlp processes for the same video.
8. **Treat non-empty output file as success** even if yt-dlp exits non-zero — the JS runtime warning causes non-zero exits on systems without Deno/Node JS runtime support.
