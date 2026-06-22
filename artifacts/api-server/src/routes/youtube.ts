import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";

const router: IRouter = Router();

const YT_DLP =
  process.env["YT_DLP_PATH"] ||
  "/home/runner/workspace/.pythonlibs/bin/yt-dlp";

function youtubeUrl(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function buildBaseUrl(req: Request) {
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

function streamProc(
  args: string[],
  req: Request,
  res: Response,
  contentType: string,
  filename: string,
) {
  const proc = spawn(YT_DLP, args);

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

  proc.stdout.pipe(res);

  proc.stderr.on("data", (chunk: Buffer) => {
    req.log.warn({ stderr: chunk.toString().trim() }, "yt-dlp stderr");
  });

  proc.on("error", (err) => {
    req.log.error({ err }, "yt-dlp process error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Stream process failed" });
    } else {
      res.destroy();
    }
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      req.log.error({ code }, "yt-dlp exited non-zero");
    }
  });

  req.on("close", () => proc.kill("SIGTERM"));
}

/**
 * GET /api/info?url=<youtube_url>
 *
 * Returns title, one MP4 per resolution (deduplicated), and best audio.
 * All URLs point to /api/video or /api/audio — no YouTube CDN URLs exposed.
 */
router.get("/info", async (req: Request, res: Response) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing required query param: url" });
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
    proc.stdout.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      errOutput += chunk.toString();
    });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });

  if (!ok) {
    req.log.error({ errOutput }, "yt-dlp info failed");
    res.status(502).json({ error: "Failed to fetch video info", detail: errOutput.slice(0, 300) });
    return;
  }

  let info: Record<string, unknown>;
  try {
    info = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    res.status(502).json({ error: "Invalid JSON from yt-dlp" });
    return;
  }

  const id = info["id"] as string;
  const title = info["title"] as string;
  const formats = (info["formats"] as Record<string, unknown>[]) ?? [];
  const base = buildBaseUrl(req);

  const seenHeights = new Set<number>();
  const qualities: { quality: string; url: string }[] = [];
  let audioFound = false;
  let audioExt = "m4a";

  for (const f of formats) {
    const ext = f["ext"] as string;
    const vcodec = f["vcodec"] as string | undefined;
    const acodec = f["acodec"] as string | undefined;
    const height = f["height"] as number | null | undefined;

    const isAudioOnly = vcodec === "none" && acodec && acodec !== "none";
    const isVideo = vcodec && vcodec !== "none" && ext === "mp4" && height;

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

  res.json({ id, title, qualities, audio });
});

/**
 * GET /api/video?id=<video_id>&quality=<height>p
 *
 * Streams the best MP4 at the requested height inline.
 * yt-dlp resolves the format at request time — no stale URLs.
 */
router.get("/video", (req: Request, res: Response) => {
  const { id, quality } = req.query;

  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Missing required query param: id" });
    return;
  }
  if (!quality || typeof quality !== "string") {
    res.status(400).json({ error: "Missing required query param: quality" });
    return;
  }

  const height = parseInt(quality.replace("p", ""), 10);
  if (isNaN(height) || height <= 0) {
    res.status(400).json({ error: `Invalid quality value: ${quality}` });
    return;
  }

  const formatStr = `bestvideo[height=${height}][ext=mp4]/bestvideo[ext=mp4]`;

  streamProc(
    ["-f", formatStr, "-o", "-", "--no-playlist", youtubeUrl(id)],
    req,
    res,
    "video/mp4",
    `${id}_${quality}.mp4`,
  );
});

/**
 * GET /api/audio?id=<video_id>
 *
 * Streams the best available audio track inline.
 */
router.get("/audio", (req: Request, res: Response) => {
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Missing required query param: id" });
    return;
  }

  streamProc(
    ["-f", "bestaudio[ext=m4a]/bestaudio", "-o", "-", "--no-playlist", youtubeUrl(id)],
    req,
    res,
    "audio/mp4",
    `${id}_audio.m4a`,
  );
});

export default router;
