# Bunny Stream Manager

A full-stack video management app for [Bunny.net Stream](https://bunny.net/stream). Upload videos, manage collections, copy/download links, and auto-sync from a local watch folder (ideal for Handbrake output).

---

## Features

- **Upload videos** to any Bunny Stream collection via drag-and-drop or file picker
- **Manage collections** — create, delete, and switch between them
- **Auto-sync watch folder** — monitors a local folder and uploads new complete video files automatically (detects Handbrake-finished files by checking file stability and video duration)
- **Duplicate prevention** — each video is uploaded only once per collection (tracked in browser localStorage)
- **Copy / Download links** — copy iframe embed links or 480p/720p download links to clipboard, or download them as a `.txt` file named after the collection
- **Billing overview** — view your Bunny.net account balance and monthly charges
- **Credentials stored in browser** — API keys are saved in your browser's localStorage and sent securely to the backend; no database required for configuration

---

## Tech Stack

- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js (Node.js)
- **Database**: PostgreSQL via Drizzle ORM (optional — only needed if you want server-side credential fallback)
- **Deployment**: Vercel (serverless function at `api/index.ts` + static frontend)

---

## Deploy to Vercel

### 1. Push to GitHub

Push this project to a GitHub repository.

### 2. Import into Vercel

Go to [vercel.com](https://vercel.com) → **New Project** → import your repository.

Vercel will auto-detect the `vercel.json` configuration. No framework preset is needed.

### 3. Environment Variables (optional)

If you want credentials pre-seeded from the server side, add these in Vercel project settings:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon, Supabase, or Vercel Postgres) |
| `BUNNY_API_KEY` | Bunny Stream library API key (pre-fills settings) |
| `BUNNY_LIBRARY_ID` | Bunny Stream library ID (pre-fills settings) |

> **Without a database**: The app works fully without `DATABASE_URL`. All credentials are stored in browser localStorage and sent to the backend on every request via a secure header.

### 4. Deploy

Click **Deploy**. Your app will be live at `https://your-project.vercel.app`.

---

## First-Time Setup

1. Open the app and click the **Settings** (gear) icon
2. Enter your Bunny.net credentials:
   - **Account API Key** — from [bunny.net](https://dash.bunny.net) → Account → API
   - **Stream API Key** — from your Stream library → API Access
   - **Library ID** — shown in your Stream library dashboard
   - **Download Domain** — your CDN pull zone hostname (e.g. `vz-xxxxx.b-cdn.net`)
3. Click **Save** for each field — credentials are stored in your browser and persist across page refreshes

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (Express backend + Vite frontend on port 5000)
npm run dev
```

Set `DATABASE_URL` in a `.env` file if you want database-backed settings:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Push the database schema:

```bash
npm run db:push
```

---

## Auto-Sync Watch Folder

1. Select a collection from the sidebar
2. Click **Watch Folder** and choose a local folder (e.g. your Handbrake output folder)
3. The app scans every 60 seconds for new complete video files:
   - Skips temp files (`.tmp`, `.part`, hidden files)
   - Waits for file size and modification time to be stable across 3 consecutive scans
   - Validates video duration (rejects files with no playable duration — Handbrake only writes this at encode completion)
4. Complete files are uploaded automatically and never uploaded twice

---

## Build for Production

```bash
npm run build
```

Output:
- Frontend: `dist/public/`
- Server bundle: `dist/index.cjs` (for non-Vercel self-hosting)
