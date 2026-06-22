import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

router.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>YT Proxy — Dashboard</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #7d8590;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    min-height: 100vh;
    padding: 32px 16px;
  }
  header {
    max-width: 900px;
    margin: 0 auto 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon {
    width: 36px; height: 36px; background: var(--red);
    border-radius: 8px; display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }
  h1 { font-size: 1.25rem; font-weight: 600; }
  .badge {
    padding: 3px 10px; border-radius: 20px; font-size: 0.75rem;
    font-weight: 600; border: 1px solid;
  }
  .badge-green { color: var(--green); border-color: var(--green); background: #3fb95015; }
  .badge-red   { color: var(--red);   border-color: var(--red);   background: #f8514915; }

  .grid {
    max-width: 900px; margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .card-label {
    font-size: 0.7rem; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 10px;
  }
  .card-value {
    font-size: 1.5rem; font-weight: 700; line-height: 1;
    color: var(--text);
  }
  .card-value.accent { color: var(--accent); }
  .card-value.green  { color: var(--green); }
  .card-value.purple { color: var(--purple); }
  .card-sub {
    font-size: 0.75rem; color: var(--muted); margin-top: 5px;
  }
  .card-wide {
    grid-column: span 2;
  }

  .section-title {
    max-width: 900px; margin: 28px auto 14px;
    font-size: 0.8rem; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted);
    border-bottom: 1px solid var(--border); padding-bottom: 8px;
  }

  .api-grid {
    max-width: 900px; margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .api-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 18px;
  }
  .api-method {
    display: inline-block;
    font-size: 0.65rem; font-weight: 700;
    padding: 2px 7px; border-radius: 4px;
    background: #58a6ff20; color: var(--accent);
    margin-bottom: 8px;
  }
  .api-path { font-size: 0.9rem; font-weight: 600; margin-bottom: 4px; }
  .api-desc { font-size: 0.75rem; color: var(--muted); }
  .api-link {
    display: inline-block; margin-top: 8px;
    font-size: 0.72rem; color: var(--accent);
    text-decoration: none; opacity: 0.8;
  }
  .api-link:hover { opacity: 1; text-decoration: underline; }

  .clock-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 22px 24px;
    max-width: 900px;
    margin: 0 auto;
  }
  .clock-time {
    font-size: 2.8rem; font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent); line-height: 1;
  }
  .clock-date { font-size: 1rem; color: var(--muted); margin-top: 6px; }
  .clock-tz { font-size: 0.78rem; color: var(--muted); margin-top: 4px; }

  footer {
    max-width: 900px; margin: 36px auto 0;
    font-size: 0.73rem; color: var(--muted);
    text-align: center;
  }
  .dot {
    display: inline-block; width: 8px; height: 8px;
    border-radius: 50%; background: var(--green);
    box-shadow: 0 0 0 2px #3fb95030;
    animation: pulse 2s infinite;
    vertical-align: middle; margin-right: 5px;
  }
  @keyframes pulse {
    0%,100% { box-shadow: 0 0 0 2px #3fb95030; }
    50%      { box-shadow: 0 0 0 5px #3fb95010; }
  }
  @media (max-width: 500px) {
    .card-wide { grid-column: span 1; }
    .clock-time { font-size: 2rem; }
  }
</style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">▶</div>
    <div>
      <h1>YT Proxy API</h1>
      <div style="font-size:.75rem;color:var(--muted)">YouTube video &amp; audio proxy server</div>
    </div>
  </div>
  <span class="badge badge-green" id="status-badge"><span class="dot"></span>Online</span>
</header>

<div class="section-title" style="max-width:900px;margin:0 auto 14px;">Your Local Time</div>
<div class="clock-card">
  <div class="clock-time" id="clock-time">--:--:--</div>
  <div class="clock-date" id="clock-date">---</div>
  <div class="clock-tz"   id="clock-tz">Detecting timezone…</div>
</div>

<div class="section-title">Server Metrics</div>
<div class="grid">
  <div class="card">
    <div class="card-label">Uptime</div>
    <div class="card-value green" id="uptime">--</div>
    <div class="card-sub" id="uptime-sec">-- seconds</div>
  </div>
  <div class="card">
    <div class="card-label">Requests / sec</div>
    <div class="card-value accent" id="rps">--</div>
    <div class="card-sub">10-second window</div>
  </div>
  <div class="card">
    <div class="card-label">Total Requests</div>
    <div class="card-value" id="total-req">--</div>
    <div class="card-sub">since last restart</div>
  </div>
  <div class="card">
    <div class="card-label">Heap Used</div>
    <div class="card-value purple" id="heap">--</div>
    <div class="card-sub" id="heap-total">of -- MB total</div>
  </div>
  <div class="card">
    <div class="card-label">RSS Memory</div>
    <div class="card-value" id="rss">--</div>
    <div class="card-sub">MB resident</div>
  </div>
  <div class="card">
    <div class="card-label">Load Average</div>
    <div class="card-value" id="load">--</div>
    <div class="card-sub" id="cpus">-- CPUs</div>
  </div>
  <div class="card">
    <div class="card-label">Node.js</div>
    <div class="card-value accent" id="node-ver">--</div>
    <div class="card-sub" id="platform">--</div>
  </div>
  <div class="card">
    <div class="card-label">Environment</div>
    <div class="card-value" id="env">--</div>
    <div class="card-sub" id="arch">--</div>
  </div>
</div>

<div class="section-title">API Endpoints</div>
<div class="api-grid">
  <div class="api-card">
    <div class="api-method">GET</div>
    <div class="api-path">/api/healthz</div>
    <div class="api-desc">Health check — returns <code>{"status":"ok"}</code></div>
    <a class="api-link" href="/api/healthz" target="_blank">Try it →</a>
  </div>
  <div class="api-card">
    <div class="api-method">GET</div>
    <div class="api-path">/api/stats</div>
    <div class="api-desc">Live server metrics — uptime, req/s, memory, load</div>
    <a class="api-link" href="/api/stats" target="_blank">Try it →</a>
  </div>
  <div class="api-card">
    <div class="api-method">GET</div>
    <div class="api-path">/api/info?url=</div>
    <div class="api-desc">Extract video metadata, qualities, thumbnail, audio URL</div>
    <a class="api-link" href="/api/info?url=https://youtu.be/vBynw9Isr28" target="_blank">Try example →</a>
  </div>
  <div class="api-card">
    <div class="api-method">GET</div>
    <div class="api-path">/api/video?id=&amp;quality=</div>
    <div class="api-desc">Stream muxed MP4 (video + audio), supports HTTP Range</div>
    <a class="api-link" href="/api/video?id=vBynw9Isr28&quality=360p" target="_blank">Try example →</a>
  </div>
  <div class="api-card">
    <div class="api-method">GET</div>
    <div class="api-path">/api/audio?id=</div>
    <div class="api-desc">Stream best audio track (M4A), supports HTTP Range</div>
    <a class="api-link" href="/api/audio?id=vBynw9Isr28" target="_blank">Try example →</a>
  </div>
</div>

<footer>
  <p>YT Proxy API &mdash; refreshes every second &mdash; <span id="last-update">--</span></p>
</footer>

<script>
(function () {
  // ── Clock ────────────────────────────────────────────────────────────────
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('clock-tz').textContent = 'Timezone: ' + tz;

  function tickClock() {
    const now = new Date();
    document.getElementById('clock-time').textContent =
      now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false });
    document.getElementById('clock-date').textContent =
      now.toLocaleDateString('en-US', {
        timeZone: tz, weekday: 'long',
        year: 'numeric', month: 'long', day: 'numeric'
      });
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ── Stats polling ─────────────────────────────────────────────────────────
  function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  async function fetchStats() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) throw new Error('non-200');
      const d = await r.json();

      set('uptime',      d.uptimeHuman);
      set('uptime-sec',  d.uptime + ' seconds');
      set('rps',         d.requestsPerSecond);
      set('total-req',   d.totalRequests.toLocaleString());
      set('heap',        d.memoryMB.heapUsed + ' MB');
      set('heap-total',  'of ' + d.memoryMB.heapTotal + ' MB total');
      set('rss',         d.memoryMB.rss + ' MB');
      set('load',        d.loadAvg[0]);
      set('cpus',        d.cpus + ' CPUs');
      set('node-ver',    d.nodeVersion);
      set('platform',    d.platform + ' / ' + d.arch);
      set('env',         d.env);
      set('arch',        d.arch);

      const badge = document.getElementById('status-badge');
      badge.className = 'badge badge-green';
      badge.innerHTML = '<span class="dot"></span>Online';

      set('last-update', 'Updated ' + new Date().toLocaleTimeString());
    } catch (e) {
      const badge = document.getElementById('status-badge');
      badge.className = 'badge badge-red';
      badge.textContent = 'Unreachable';
    }
  }

  fetchStats();
  setInterval(fetchStats, 1000);
})();
</script>
</body>
</html>`;

export default router;
