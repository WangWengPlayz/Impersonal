# Deploying to Render.com

## Step 1 — Create a Web Service

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub/GitLab repo
3. Fill in the fields below **exactly**

---

## Step 2 — Settings

| Field | Value |
|---|---|
| **Runtime** | `Node` |
| **Build Command** | `pip install -U yt-dlp && npm install -g pnpm@10.26.1 && pnpm install && pnpm --filter @workspace/api-server run build` |
| **Start Command** | `node --enable-source-maps artifacts/api-server/dist/index.mjs` |

---

## Step 3 — Environment Variables

Add these in the **Environment** tab:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `YT_COOKIES_BASE64` | *(see Step 3a below — required to bypass YouTube bot detection)* |

> `PORT` is injected automatically by Render — do **not** set it manually.

---

## Step 3a — Export Your YouTube Cookies (required)

YouTube blocks yt-dlp on server IPs unless it looks like a logged-in user. You need to export your browser cookies once and paste them as an env var.

### 1. Install a browser extension

- **Chrome / Edge**: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
- **Firefox**: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

### 2. Export cookies for youtube.com

1. Log in to [youtube.com](https://youtube.com) in your browser
2. Click the extension icon
3. Select **youtube.com** → export as `cookies.txt` (Netscape format)

### 3. Base64-encode the file

**Mac / Linux terminal:**
```bash
base64 -i cookies.txt | tr -d '\n'
```

**Windows PowerShell:**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))
```

### 4. Add to Render

In your Render service → **Environment** tab → add:

| Key | Value |
|---|---|
| `YT_COOKIES_BASE64` | *(paste the entire base64 string)* |

Click **Save Changes** — Render will restart your service automatically.

> Cookies expire every few weeks. Repeat Steps 2–4 if you start seeing bot errors again.

---

## Step 4 — Deploy

Click **Create Web Service**. The build will:

1. Install `yt-dlp` (Python CLI for YouTube)
2. Install `pnpm`
3. Install all Node dependencies
4. Compile TypeScript → ESM bundle

First deploy takes ~2 minutes. After that, your API is live at `https://<your-service>.onrender.com`.

---

## Quick Test

Once deployed, open:

```
https://<your-service>.onrender.com/
```

You should see the live dashboard. Then test the API:

```
https://<your-service>.onrender.com/api/healthz
https://<your-service>.onrender.com/api/info?url=https://youtu.be/vBynw9Isr28
```
