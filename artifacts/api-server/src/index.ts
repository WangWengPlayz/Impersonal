import app from "./app";
import { logger } from "./lib/logger";
import { shutdown as shutdownYoutube } from "./routes/youtube";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
  logger.info({ port, env: process.env["NODE_ENV"] ?? "development" }, "Server listening");
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  logger.info({ signal }, "Shutdown signal received — closing server");

  // Kill any active yt-dlp subprocesses
  shutdownYoutube();

  server.close(() => {
    logger.info("HTTP server closed cleanly");
    process.exit(0);
  });

  // Force exit if server doesn't close within 15 s
  setTimeout(() => {
    logger.warn("Forced exit — server did not close in time");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─── Safety nets ──────────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — exiting");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — exiting");
  process.exit(1);
});
