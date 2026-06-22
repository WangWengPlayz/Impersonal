import os from "os";

const startTime = Date.now();

const WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

export function recordRequest(): void {
  const now = Date.now();
  requestTimestamps.push(now);
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < requestTimestamps.length && requestTimestamps[i]! < cutoff) i++;
  if (i > 0) requestTimestamps.splice(0, i);
}

export function getStats() {
  const now = Date.now();
  const uptimeSec = Math.floor((now - startTime) / 1000);

  const cutoff10s = now - 10_000;
  const recentCount = requestTimestamps.filter((t) => t >= cutoff10s).length;
  const reqPerSec = parseFloat((recentCount / 10).toFixed(2));

  const mem = process.memoryUsage();

  return {
    uptime: uptimeSec,
    uptimeHuman: formatUptime(uptimeSec),
    totalRequests: requestTimestamps.length > 0
      ? requestTimestamps.length
      : 0,
    requestsPerSecond: reqPerSec,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    env: process.env["NODE_ENV"] ?? "development",
    memoryMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    cpus: os.cpus().length,
    loadAvg: os.loadavg().map((n) => parseFloat(n.toFixed(2))),
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
