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
| `DATABASE_URL` | *(your Postgres connection string)* |

> `PORT` is injected automatically by Render — do **not** set it manually.

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
