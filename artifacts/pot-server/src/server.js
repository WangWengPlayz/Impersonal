import express from "express";
import { generate } from "youtube-po-token-generator";

const app = express();
app.use(express.json());
app.disable("x-powered-by");

const PORT = parseInt(process.env.PORT || "8000", 10);

// How long a cached token is considered valid (default: 5 minutes).
// YouTube's botguard tokens expire, so we regenerate before they do.
const CACHE_TTL_MS = parseInt(process.env.TOKEN_TTL_MS || "300000", 10);

let tokenCache = null;       // { poToken, visitorData, expiresAt }
let pendingGeneration = null; // deduplicates concurrent first requests

/**
 * Return a valid {poToken, visitorData} pair, regenerating if the cache
 * is stale. Concurrent callers share a single in-flight generation promise
 * so we never hammer YouTube simultaneously.
 */
async function getToken() {
  const now = Date.now();

  if (tokenCache && now < tokenCache.expiresAt) {
    return tokenCache;
  }

  if (pendingGeneration) {
    return pendingGeneration;
  }

  pendingGeneration = generate()
    .then(({ poToken, visitorData }) => {
      tokenCache = { poToken, visitorData, expiresAt: Date.now() + CACHE_TTL_MS };
      pendingGeneration = null;
      return tokenCache;
    })
    .catch((err) => {
      pendingGeneration = null;
      throw err;
    });

  return pendingGeneration;
}

// ─── Warm-up deferred ────────────────────────────────────────────────────────
// We do NOT warm up at startup. jsdom + YouTube's player JS needs ~500 MB–1 GB
// of heap to execute botguard; pre-warming during boot causes OOM on small
// instances. The first real /get_pot request triggers generation instead.

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    tokenCached: tokenCache !== null && Date.now() < tokenCache.expiresAt,
    cacheExpiresIn: tokenCache
      ? Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000))
      : 0,
  });
});

async function handleGetPot(_req, res) {
  try {
    const { poToken, visitorData } = await getToken();
    res.json({ po_token: poToken, visitor_data: visitorData });
  } catch (err) {
    console.error("Token generation error:", err.message);
    res.status(500).json({ error: "Failed to generate PO token. Check server logs." });
  }
}

// yt-dlp's pot provider plugin calls GET /get_pot; also accept POST for flexibility
app.get("/get_pot", handleGetPot);
app.post("/get_pot", handleGetPot);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`POT server listening on port ${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`${signal} received — shutting down.`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException",  (err) => { console.error("Uncaught:", err); process.exit(1); });
process.on("unhandledRejection", (err) => { console.error("Unhandled:", err); process.exit(1); });
