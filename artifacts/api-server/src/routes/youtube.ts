import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const YT_DLP = process.env["YT_DLP_PATH"] || "yt-dlp";
const CACHE_DIR = "/tmp/ytcache";

fs.mkdirSync(CACHE_DIR, { recursive: true });

// Prevent duplicate concurrent downloads for the same file
const downloadLocks = new Map<string, Promise<void>>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function youtubeUrl(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function buildBaseUrl(req: Request): string {
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers["host"] ||
    "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ||
    req.protocol ||
    "https";
  return `${proto}://${host}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim();
}

function apiSuccess(
  res: Response,
  data: unknown,
  message: string,
  status = 200,
) {
  res.status(status).json({ status, success: true, message, data });
}

function apiError(res: Response, message: string, status: number) {
  res.status(status).json({ status, success: false, message });
}

// ─── yt-dlp helpers ──────────────────────────────────────────────────────────

/**
 * Fetch and cache the video title.
 * Returns the video ID as fallback if the title cannot be retrieved.
 */
async function fetchTitle(id: string): Promise<string> {
  const titleFile = path.join(CACHE_DIR, `${id}.title`);
  if (fs.existsSync(titleFile)) {
    return fs.readFileSync(titleFile, "utf8").trim();
  }

  return new Promise((resolve) => {
    let out = "";
    const proc = spawn(YT_DLP, [
      "--print",
      "title",
      "--no-playlist",
      youtubeUrl(id),
    ]);
    proc.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    proc.on("close", () => {
      const title = out.trim() || id;
      try {
        fs.writeFileSync(titleFile, title, "utf8");
      } catch {
        /* ignore */
      }
      resolve(title);
    });
    proc.on("error", () => resolve(id));
  });
}

/**
 * Download video (with merged audio) to the cache dir.
 * Uses a lock so concurrent requests for the same file only trigger one download.
 */
function ensureVideo(id: string, quality: string): Promise<void> {
  const lockKey = `${id}_${quality}`;
  const filePath = path.join(CACHE_DIR, `${lockKey}.mp4`);

  if (fs.existsSync(filePath)) return Promise.resolve();

  const existing = downloadLocks.get(lockKey);
  if (existing) return existing;

  const height = parseInt(quality.replace("p", ""), 10);

  // Prefer exact height MP4 + best audio; fall back to next-best combined MP4
  const formatStr =
    `bestvideo[height=${height}][ext=mp4]+bestaudio[ext=m4a]` +
    `/bestvideo[height=${height}][ext=mp4]+bestaudio` +
    `/best[height<=${height}][ext=mp4]`;

  const promise = new Promise<void>((resolve, reject) => {
    const proc = spawn(YT_DLP, [
      "-f",
      formatStr,
      "--merge-output-format",
      "mp4",
      "-o",
      filePath,
      "--no-playlist",
      youtubeUrl(id),
    ]);
    proc.on("close", (code) => {
      downloadLocks.delete(lockKey);
      // yt-dlp may exit non-zero due to JS runtime warnings while still
      // successfully writing the merged file — treat a non-empty file as success
      const fileOk =
        fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
      if (code === 0 || fileOk) resolve();
      else reject(new Error(`yt-dlp video download exited ${code}`));
    });
    proc.on("error", (err) => {
      downloadLocks.delete(lockKey);
      reject(err);
    });
  });

  downloadLocks.set(lockKey, promise);
  return promise;
}

/**
 * Download best audio to the cache dir.
 */
function ensureAudio(id: string): Promise<void> {
  const lockKey = `${id}_audio`;
  const filePath = path.join(CACHE_DIR, `${lockKey}.m4a`);

  if (fs.existsSync(filePath)) return Promise.resolve();

  const existing = downloadLocks.get(lockKey);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const proc = spawn(YT_DLP, [
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "-o",
      filePath,
      "--no-playlist",
      youtubeUrl(id),
    ]);
    proc.on("close", (code) => {
      downloadLocks.delete(lockKey);
      const fileOk =
        fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
      if (code === 0 || fileOk) resolve();
      else reject(new Error(`yt-dlp audio download exited ${code}`));
    });
    proc.on("error", (err) => {
      downloadLocks.delete(lockKey);
      reject(err);
    });
  });

  downloadLocks.set(lockKey, promise);
  return promise;
}

/**
 * Serve a cached file with full HTTP Range (206 Partial Content) support.
 * This enables seeking in browsers and HTML5 <video> / <audio> players.
 */
function serveWithRanges(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
  filename: string,
) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    apiError(res, "Cached file not found.", 500);
    return;
  }

  const fileSize = stat.size;
  const safeFilename = sanitizeFilename(filename);

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${safeFilename}"`,
  );

  const rangeHeader = req.headers["range"];

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader
      .replace(/bytes=/, "")
      .split("-");
    const start = parseInt(startStr ?? "0", 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;

    if (start > end || start >= fileSize) {
      res.setHeader(
        "Content-Range",
        `bytes */${fileSize}`,
      );
      apiError(res, "Range Not Satisfiable.", 416);
      return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", chunkSize);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", fileSize);
    fs.createReadStream(filePath).pipe(res);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

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

  let raw = "";
  let errOutput = "";

  const ok = await new Promise<boolean>((resolve) => {
    const proc = spawn(YT_DLP, [
      "--dump-json",
      "--skip-download",
      "--no-playlist",
      url,
    ]);
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
    req.log.error({ errOutput }, "yt-dlp info failed");
    const notFound =
      errOutput.toLowerCase().includes("video unavailable") ||
      errOutput.toLowerCase().includes("private video") ||
      errOutput.toLowerCase().includes("not found");
    apiError(
      res,
      notFound
        ? "Video not found or unavailable."
        : "Failed to fetch video information.",
      notFound ? 404 : 502,
    );
    return;
  }

  let info: Record<string, unknown>;
  try {
    info = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    apiError(res, "Failed to parse video metadata.", 502);
    return;
  }

  const id = info["id"] as string;
  const title = info["title"] as string;
  const formats = (info["formats"] as Record<string, unknown>[]) ?? [];
  const base = buildBaseUrl(req);

  // Best thumbnail — prefer maxresdefault, fall back to what yt-dlp reports
  const thumbnail =
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

  const seenHeights = new Set<number>();
  const qualities: { quality: string; url: string }[] = [];
  let audioExt = "m4a";
  let audioFound = false;

  for (const f of formats) {
    const ext = f["ext"] as string;
    const vcodec = f["vcodec"] as string | undefined;
    const acodec = f["acodec"] as string | undefined;
    const height = f["height"] as number | null | undefined;

    const isAudioOnly =
      vcodec === "none" && acodec && acodec !== "none";
    const isVideo =
      vcodec && vcodec !== "none" && ext === "mp4" && height;

    if (!audioFound && isAudioOnly) {
      audioFound = true;
      audioExt = ext;
    }

    if (isVideo && height && !seenHeights.has(height)) {
      seenHeights.add(height);
      const quality = `${height}p`;
      qualities.push({
        quality,
        url: `${base}/api/video?id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`,
      });
    }
  }

  const audio = audioFound
    ? {
        format: audioExt,
        url: `${base}/api/audio?id=${encodeURIComponent(id)}`,
      }
    : null;

  // Cache title for use by /api/video and /api/audio
  try {
    fs.writeFileSync(path.join(CACHE_DIR, `${id}.title`), title, "utf8");
  } catch {
    /* ignore */
  }

  apiSuccess(
    res,
    { id, title, thumbnail, qualities, audio },
    "Video information retrieved successfully.",
  );
});

/**
 * GET /api/video?id=<video_id>&quality=<height>p
 *
 * Downloads (first call) and caches a fully muxed MP4 (video + audio).
 * Supports HTTP Range requests for full seeking in HTML5 players.
 */
router.get("/video", async (req: Request, res: Response) => {
  const { id, quality } = req.query;

  if (!id || typeof id !== "string") {
    apiError(res, "Missing required query param: id", 400);
    return;
  }
  if (!quality || typeof quality !== "string") {
    apiError(res, "Missing required query param: quality", 400);
    return;
  }

  const height = parseInt(quality.replace("p", ""), 10);
  if (isNaN(height) || height <= 0) {
    apiError(res, `Invalid quality value: ${quality}`, 400);
    return;
  }

  const [title, downloadResult] = await Promise.all([
    fetchTitle(id),
    ensureVideo(id, quality).catch((err: Error) => err),
  ]);

  if (downloadResult instanceof Error) {
    req.log.error({ err: downloadResult }, "Video download failed");
    apiError(res, "Failed to download video.", 502);
    return;
  }

  const filePath = path.join(CACHE_DIR, `${id}_${quality}.mp4`);
  const filename = `${title} [${quality}].mp4`;

  serveWithRanges(req, res, filePath, "video/mp4", filename);
});

/**
 * GET /api/audio?id=<video_id>
 *
 * Downloads (first call) and caches the best audio track.
 * Supports HTTP Range requests for full seeking.
 */
router.get("/audio", async (req: Request, res: Response) => {
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    apiError(res, "Missing required query param: id", 400);
    return;
  }

  const [title, downloadResult] = await Promise.all([
    fetchTitle(id),
    ensureAudio(id).catch((err: Error) => err),
  ]);

  if (downloadResult instanceof Error) {
    req.log.error({ err: downloadResult }, "Audio download failed");
    apiError(res, "Failed to download audio.", 502);
    return;
  }

  const filePath = path.join(CACHE_DIR, `${id}_audio.m4a`);
  const filename = `${title}.m4a`;

  serveWithRanges(req, res, filePath, "audio/mp4", filename);
});

export default router;
