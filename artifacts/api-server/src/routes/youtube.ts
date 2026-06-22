import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";

const router: IRouter = Router();

const YT_DLP = "/home/runner/workspace/.pythonlibs/bin/yt-dlp";

function youtubeUrl(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function buildProxyUrl(req: Request, id: string, fmtid: string) {
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers["host"] ||
    "localhost";
  const proto =
    req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${host}/api/stream?id=${encodeURIComponent(id)}&fmtid=${encodeURIComponent(fmtid)}`;
}

/**
 * GET /api/info?url=<youtube_url>
 *
 * Returns video title, all video qualities, and a best-audio entry.
 * Each format URL points back to this server's /api/stream endpoint.
 */
router.get("/info", async (req: Request, res: Response) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing required query param: url" });
    return;
  }

  let raw = "";
  let errOutput = "";

  await new Promise<void>((resolve, reject) => {
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
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited ${code}: ${errOutput}`));
    });
    proc.on("error", reject);
  }).catch((err: Error) => {
    req.log.error({ err }, "yt-dlp info failed");
    res
      .status(502)
      .json({ error: "Failed to fetch video info", detail: err.message });
  });

  if (res.headersSent) return;

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

  const qualities: {
    quality: string;
    format: string;
    width: number | null;
    height: number | null;
    fps: number | null;
    fmtid: string;
    url: string;
  }[] = [];

  let audioFmt: Record<string, unknown> | null = null;

  for (const f of formats) {
    const vcodec = f["vcodec"] as string | undefined;
    const acodec = f["acodec"] as string | undefined;
    const fmtid = f["format_id"] as string;
    const ext = f["ext"] as string;
    const height = (f["height"] as number | null) ?? null;
    const width = (f["width"] as number | null) ?? null;
    const fps = (f["fps"] as number | null) ?? null;
    const formatNote = f["format_note"] as string | undefined;

    const isVideoOnly = vcodec && vcodec !== "none";
    const isAudioOnly = vcodec === "none" && acodec && acodec !== "none";

    if (audioFmt === null && isAudioOnly) {
      audioFmt = f;
    }

    if (isVideoOnly) {
      const quality =
        formatNote ||
        (height ? `${height}p` : "Unknown");

      qualities.push({
        quality,
        format: ext,
        width,
        height,
        fps,
        fmtid,
        url: buildProxyUrl(req, id, fmtid),
      });
    }
  }

  const audio =
    audioFmt !== null
      ? {
          format: audioFmt["ext"] as string,
          fmtid: audioFmt["format_id"] as string,
          url: buildProxyUrl(req, id, audioFmt["format_id"] as string),
        }
      : null;

  res.json({ id, title, qualities, audio });
});

/**
 * GET /api/stream?id=<video_id>&fmtid=<format_id>
 *
 * Streams the requested format directly from YouTube via yt-dlp stdout.
 * The client bears no knowledge of Google's short-lived CDN URLs.
 */
router.get("/stream", (req: Request, res: Response) => {
  const { id, fmtid } = req.query;

  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Missing required query param: id" });
    return;
  }
  if (!fmtid || typeof fmtid !== "string") {
    res.status(400).json({ error: "Missing required query param: fmtid" });
    return;
  }

  const proc = spawn(YT_DLP, [
    "-f",
    fmtid,
    "-o",
    "-",
    "--no-playlist",
    youtubeUrl(id),
  ]);

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${id}_${fmtid}"`,
  );

  proc.stdout.pipe(res);

  proc.stderr.on("data", (chunk: Buffer) => {
    req.log.warn({ stderr: chunk.toString().trim() }, "yt-dlp stream stderr");
  });

  proc.on("error", (err) => {
    req.log.error({ err }, "yt-dlp stream process error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Stream process failed" });
    } else {
      res.destroy();
    }
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      req.log.error({ code }, "yt-dlp stream exited non-zero");
    }
  });

  req.on("close", () => {
    proc.kill("SIGTERM");
  });
});

export default router;
