import { Router, type IRouter, type Request, type Response } from "express";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

// ─── Config (all overridable via env) ────────────────────────────────────────

const YT_DLP = process.env["YT_DLP_PATH"] || "yt-dlp";
const CACHE_DIR = process.env["CACHE_DIR"] || "/tmp/ytcache";
const COOKIES_FILE = process.env["YT_COOKIES_FILE"] || "/tmp/yt-cookies.txt";
const CACHE_TTL_MS =
  parseInt(process.env["CACHE_TTL_MINUTES"] || "30", 10) * 60_000;
const CLEANUP_INTERVAL_MS =
  parseInt(process.env["CLEANUP_INTERVAL_MINUTES"] || "10", 10) * 60_000;
const MAX_CONCURRENT_DOWNLOADS = parseInt(
  process.env["MAX_CONCURRENT_DOWNLOADS"] || "3",
  10,
);

// ─── Cache directory ──────────────────────────────────────────────────────────

try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (err) {
  process.stderr.write(`Failed to create cache dir: ${String(err)}\n`);
}

// ─── Cookie setup ─────────────────────────────────────────────────────────────
// If YT_COOKIES_BASE64 env var is set, decode it and write to COOKIES_FILE so
// yt-dlp can authenticate as a logged-in user (bypasses YouTube bot detection).

(function setupCookies() {
  const b64 = process.env["YT_COOKIES_BASE64"];
  if (!b64) return;
  try {
    fs.writeFileSync(
      COOKIES_FILE,
      Buffer.from(b64, "base64").toString("utf8"),
      "utf8",
    );
    process.stderr.write(`[yt-dlp] Cookies loaded from YT_COOKIES_BASE64 → ${COOKIES_FILE}\n`);
  } catch (err) {
    process.stderr.write(`[yt-dlp] Failed to write cookies file: ${String(err)}\n`);
  }
})();

// ─── Semaphore — limits concurrent yt-dlp download processes ─────────────────

class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

const downloadSemaphore = new Semaphore(MAX_CONCURRENT_DOWNLOADS);

// ─── Active process tracking (for graceful shutdown) ─────────────────────────

const activeProcs = new Set<ChildProcessWithoutNullStreams>();

function trackProc(
  proc: ChildProcessWithoutNullStreams,
): ChildProcessWithoutNullStreams {
  activeProcs.add(proc);
  proc.on("close", () => activeProcs.delete(proc));
  return proc;
}

// ─── Cache access tracking + periodic cleanup ─────────────────────────────────

const lastAccess = new Map<string, number>();

function touchFile(filePath: string): void {
  lastAccess.set(filePath, Date.now());
}

function cleanCache(): void {
  const now = Date.now();
  let deleted = 0;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(CACHE_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".mp4") && !entry.endsWith(".m4a")) continue;
    const filePath = path.join(CACHE_DIR, entry);
    const accessed = lastAccess.get(filePath) ?? 0;
    if (now - accessed > CACHE_TTL_MS) {
      try {
        fs.unlinkSync(filePath);
        lastAccess.delete(filePath);
        deleted++;
      } catch {
        /* file may already be gone */
      }
    }
  }

  if (deleted > 0) {
    process.stderr.write(`[ytcache] cleaned ${deleted} expired file(s)\n`);
  }
}

// Run cleanup periodically; unref so it doesn't keep the process alive
const cleanupTimer = setInterval(cleanCache, CLEANUP_INTERVAL_MS).unref();

// ─── Download locks — prevent duplicate concurrent downloads ──────────────────

const downloadLocks = new Map<string, Promise<void>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function youtubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** Handle Render.com sending "https,http" as x-forwarded-proto */
function buildBaseUrl(req: Request): string {
  const rawHost =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;

  const rawProto =
    (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
  const proto = (rawProto ?? "https").split(",")[0]!.trim();

  return `${proto}://${host}`;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Validate YouTube video ID format (11 chars, alphanumeric + - _) */
function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function apiSuccess(
  res: Response,
  data: unknown,
  message: string,
  status = 200,
): void {
  res.status(status).json({ status, success: true, message, data });
}

function apiError(res: Response, message: string, status: number): void {
  if (!res.headersSent) {
    res.status(status).json({ status, success: false, message });
  }
}

// ─── yt-dlp helpers ───────────────────────────────────────────────────────────

/**
 * Build base args for every yt-dlp invocation:
 * - --js-runtimes node  → required on servers without Deno
 * - --cookies FILE      → added only when the cookies file is present, so
 *                         yt-dlp authenticates as a logged-in user and avoids
 *                         YouTube's bot-detection block
 */
function buildBaseArgs(): string[] {
  const args = ["--js-runtimes", "node"];
  try {
    if (fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 0) {
      args.push("--cookies", COOKIES_FILE);
    }
  } catch { /* ignore — cookies are optional */ }
  return args;
}

function spawnYtDlp(args: string[]): ChildProcessWithoutNullStreams {
  return trackProc(spawn(YT_DLP, [...buildBaseArgs(), ...args]));
}

/** Title fetches are also locked per ID to avoid redundant concurrent calls */
const titleLocks = new Map<string, Promise<string>>();

async function fetchTitle(id: string): Promise<string> {
  const titleFile = path.join(CACHE_DIR, `${id}.title`);

  try {
    if (fs.existsSync(titleFile)) {
      return fs.readFileSync(titleFile, "utf8").trim() || id;
    }
  } catch {
    /* fall through */
  }

  const existing = titleLocks.get(id);
  if (existing) return existing;

  const promise = new Promise<string>((resolve) => {
    let out = "";
    const proc = spawnYtDlp(["--print", "title", "--no-playlist", youtubeUrl(id)]);
    proc.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    proc.on("close", () => {
      titleLocks.delete(id);
      const title = out.trim() || id;
      try {
        fs.writeFileSync(titleFile, title, "utf8");
      } catch {
        /* ignore */
      }
      resolve(title);
    });
    proc.on("error", () => {
      titleLocks.delete(id);
      resolve(id);
    });
  });

  titleLocks.set(id, promise);
  return promise;
}

/**
 * Download a fully muxed MP4 (video + audio via ffmpeg) to the cache dir.
 * Semaphore-gated, download-locked, with partial file cleanup on failure.
 */
function ensureVideo(id: string, quality: string): Promise<void> {
  const lockKey = `${id}_${quality}`;
  const filePath = path.join(CACHE_DIR, `${lockKey}.mp4`);

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      touchFile(filePath);
      return Promise.resolve();
    }
  } catch {
    /* fall through to download */
  }

  const existing = downloadLocks.get(lockKey);
  if (existing) return existing;

  const height = parseInt(quality.replace("p", ""), 10);

  const formatStr =
    `bestvideo[height=${height}][ext=mp4]+bestaudio[ext=m4a]` +
    `/bestvideo[height=${height}][ext=mp4]+bestaudio` +
    `/best[height<=${height}][ext=mp4]`;

  const promise = (async () => {
    await downloadSemaphore.acquire();
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawnYtDlp([
          "-f", formatStr,
          "--merge-output-format", "mp4",
          "-o", filePath,
          "--no-playlist",
          "--no-warnings",
          youtubeUrl(id),
        ]);

        let stderr = "";
        proc.stderr.on("data", (c: Buffer) => {
          stderr += c.toString();
        });

        proc.on("close", (code) => {
          downloadLocks.delete(lockKey);

          let fileOk = false;
          try {
            fileOk = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
          } catch {
            /* ignore */
          }

          if (code === 0 || fileOk) {
            touchFile(filePath);
            resolve();
          } else {
            // Clean up partial file
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            reject(new Error(`yt-dlp exited ${code ?? "null"}: ${stderr.slice(0, 200)}`));
          }
        });

        proc.on("error", (err) => {
          downloadLocks.delete(lockKey);
          try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          reject(err);
        });
      });
    } finally {
      downloadSemaphore.release();
    }
  })();

  downloadLocks.set(lockKey, promise);
  return promise;
}

/**
 * Download best audio to the cache dir.
 */
function ensureAudio(id: string): Promise<void> {
  const lockKey = `${id}_audio`;
  const filePath = path.join(CACHE_DIR, `${lockKey}.m4a`);

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      touchFile(filePath);
      return Promise.resolve();
    }
  } catch {
    /* fall through */
  }

  const existing = downloadLocks.get(lockKey);
  if (existing) return existing;

  const promise = (async () => {
    await downloadSemaphore.acquire();
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawnYtDlp([
          "-f", "bestaudio[ext=m4a]/bestaudio",
          "-o", filePath,
          "--no-playlist",
          "--no-warnings",
          youtubeUrl(id),
        ]);

        let stderr = "";
        proc.stderr.on("data", (c: Buffer) => {
          stderr += c.toString();
        });

        proc.on("close", (code) => {
          downloadLocks.delete(lockKey);

          let fileOk = false;
          try {
            fileOk = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
          } catch {
            /* ignore */
          }

          if (code === 0 || fileOk) {
            touchFile(filePath);
            resolve();
          } else {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            reject(new Error(`yt-dlp exited ${code ?? "null"}: ${stderr.slice(0, 200)}`));
          }
        });

        proc.on("error", (err) => {
          downloadLocks.delete(lockKey);
          try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          reject(err);
        });
      });
    } finally {
      downloadSemaphore.release();
    }
  })();

  downloadLocks.set(lockKey, promise);
  return promise;
}

/**
 * Serve a cached file with full HTTP Range (206 Partial Content) support.
 * Handles all browser, mobile, download-manager, and bot clients correctly.
 */
function serveWithRanges(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
  filename: string,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    apiError(res, "Cached media file not found.", 500);
    return;
  }

  const fileSize = stat.size;
  const safeFilename = sanitizeFilename(filename);

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${safeFilename}"`,
  );

  touchFile(filePath);

  const rangeHeader = req.headers["range"];

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!match) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      apiError(res, "Malformed Range header.", 416);
      return;
    }

    const startRaw = match[1] ? parseInt(match[1], 10) : 0;
    const endRaw = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    const start = isNaN(startRaw) ? 0 : startRaw;
    const end = isNaN(endRaw) ? fileSize - 1 : Math.min(endRaw, fileSize - 1);

    if (start > end || start >= fileSize) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      apiError(res, "Range Not Satisfiable.", 416);
      return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", chunkSize);

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", () => {
      if (!res.headersSent) apiError(res, "Stream error.", 500);
      else res.destroy();
    });
    stream.pipe(res);
  } else {
    res.setHeader("Content-Length", fileSize);

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) apiError(res, "Stream error.", 500);
      else res.destroy();
    });
    stream.pipe(res);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/info?url=<youtube_url>
 *
 * Returns: title, thumbnail, one deduplicated MP4 per resolution, best audio.
 * All stream URLs point to this server — no YouTube CDN URLs exposed.
 */
router.get("/info", async (req: Request, res: Response) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    apiError(res, "Missing required query param: url", 400);
    return;
  }

  // Basic sanity check — reject obviously invalid inputs early
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    apiError(res, "Only YouTube URLs are supported.", 400);
    return;
  }

  let raw = "";
  let errOutput = "";

  const proc = spawnYtDlp([
    "--dump-json",
    "--skip-download",
    "--no-playlist",
    url,
  ]);

  const ok = await new Promise<boolean>((resolve) => {
    proc.stdout.on("data", (c: Buffer) => {
      raw += c.toString();
    });
    proc.stderr.on("data", (c: Buffer) => {
      errOutput += c.toString();
    });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });

  if (!ok) {
    req.log.error({ url, errOutput: errOutput.slice(0, 500) }, "yt-dlp info failed");

    const lower = errOutput.toLowerCase();
    const notFound =
      lower.includes("video unavailable") ||
      lower.includes("private video") ||
      lower.includes("not found") ||
      lower.includes("has been removed");

    apiError(
      res,
      notFound
        ? "Video not found or unavailable."
        : "Failed to fetch video information. The video may be unavailable.",
      notFound ? 404 : 502,
    );
    return;
  }

  let info: Record<string, unknown>;
  try {
    info = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    req.log.error("Failed to parse yt-dlp JSON output");
    apiError(res, "Failed to parse video metadata.", 502);
    return;
  }

  const id = (info["id"] as string | undefined) ?? "";
  const title = (info["title"] as string | undefined) ?? id;
  const formats = (info["formats"] as Record<string, unknown>[]) ?? [];
  const base = buildBaseUrl(req);

  const thumbnail = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

  const seenHeights = new Set<number>();
  const qualities: { quality: string; url: string }[] = [];
  let audioExt = "m4a";
  let audioFound = false;

  for (const f of formats) {
    const ext = f["ext"] as string | undefined;
    const vcodec = f["vcodec"] as string | undefined;
    const acodec = f["acodec"] as string | undefined;
    const height = f["height"] as number | null | undefined;

    const isAudioOnly =
      vcodec === "none" && acodec && acodec !== "none";
    const isVideo =
      vcodec && vcodec !== "none" && ext === "mp4" && height;

    if (!audioFound && isAudioOnly) {
      audioFound = true;
      audioExt = (ext as string | undefined) ?? "m4a";
    }

    if (isVideo && height && !seenHeights.has(height)) {
      seenHeights.add(height);
      qualities.push({
        quality: `${height}p`,
        url: `${base}/api/video?id=${encodeURIComponent(id)}&quality=${encodeURIComponent(`${height}p`)}`,
      });
    }
  }

  const audio = audioFound
    ? {
        format: audioExt,
        url: `${base}/api/audio?id=${encodeURIComponent(id)}`,
      }
    : null;

  // Cache title for subsequent /api/video and /api/audio calls
  try {
    fs.writeFileSync(path.join(CACHE_DIR, `${id}.title`), title, "utf8");
  } catch {
    /* non-fatal */
  }

  req.log.info({ id, title, qualityCount: qualities.length }, "info fetched");

  apiSuccess(
    res,
    { id, title, thumbnail, qualities, audio },
    "Video information retrieved successfully.",
  );
});

/**
 * GET /api/video?id=<video_id>&quality=<height>p
 *
 * Downloads (first call) and caches a fully muxed MP4 (video + audio via ffmpeg).
 * Supports HTTP Range requests — seeking works in all browsers and players.
 */
router.get("/video", async (req: Request, res: Response) => {
  const { id, quality } = req.query;

  if (!id || typeof id !== "string") {
    apiError(res, "Missing required query param: id", 400);
    return;
  }
  if (!isValidVideoId(id)) {
    apiError(res, "Invalid video ID format.", 400);
    return;
  }
  if (!quality || typeof quality !== "string") {
    apiError(res, "Missing required query param: quality", 400);
    return;
  }

  const height = parseInt(quality.replace(/p$/i, ""), 10);
  if (isNaN(height) || height <= 0 || height > 8640) {
    apiError(res, `Invalid quality value: ${quality}`, 400);
    return;
  }

  const normalizedQuality = `${height}p`;

  req.log.info({ id, quality: normalizedQuality }, "video request");

  const [title, downloadResult] = await Promise.all([
    fetchTitle(id),
    ensureVideo(id, normalizedQuality).catch((err: unknown) =>
      err instanceof Error ? err : new Error(String(err)),
    ),
  ]);

  if (downloadResult instanceof Error) {
    req.log.error(
      { id, quality: normalizedQuality, err: downloadResult.message },
      "Video download failed",
    );
    apiError(res, "Failed to prepare video. Please try again.", 502);
    return;
  }

  const filePath = path.join(CACHE_DIR, `${id}_${normalizedQuality}.mp4`);
  const filename = `${title} [${normalizedQuality}].mp4`;

  serveWithRanges(req, res, filePath, "video/mp4", filename);
});

/**
 * GET /api/audio?id=<video_id>
 *
 * Downloads (first call) and caches the best audio track (prefers m4a).
 * Supports HTTP Range requests.
 */
router.get("/audio", async (req: Request, res: Response) => {
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    apiError(res, "Missing required query param: id", 400);
    return;
  }
  if (!isValidVideoId(id)) {
    apiError(res, "Invalid video ID format.", 400);
    return;
  }

  req.log.info({ id }, "audio request");

  const [title, downloadResult] = await Promise.all([
    fetchTitle(id),
    ensureAudio(id).catch((err: unknown) =>
      err instanceof Error ? err : new Error(String(err)),
    ),
  ]);

  if (downloadResult instanceof Error) {
    req.log.error(
      { id, err: downloadResult.message },
      "Audio download failed",
    );
    apiError(res, "Failed to prepare audio. Please try again.", 502);
    return;
  }

  const filePath = path.join(CACHE_DIR, `${id}_audio.m4a`);
  const filename = `${title}.m4a`;

  serveWithRanges(req, res, filePath, "audio/mp4", filename);
});

// ─── Graceful shutdown export ─────────────────────────────────────────────────

export function shutdown(): void {
  clearInterval(cleanupTimer);
  for (const proc of activeProcs) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  activeProcs.clear();
}

export default router;
