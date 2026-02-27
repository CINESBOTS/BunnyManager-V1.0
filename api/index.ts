import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";

const BUNNY_API_URL = "https://video.bunnycdn.com";

const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

function parseConfig(req: Request): Record<string, string> {
  const header = req.headers["x-bunny-config"];
  if (!header || typeof header !== "string") return {};
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function bunnyHeaders(apiKey: string, contentType?: string): Record<string, string> {
  const h: Record<string, string> = { AccessKey: apiKey, accept: "application/json" };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

function getConfig(req: Request) {
  const c = parseConfig(req);
  return {
    apiKey: c["api_key"] || null,
    libraryId: c["library_id"] || null,
    downloadDomain: c["download_domain"] || null,
    accountApiKey: c["account_api_key"] || null,
  };
}

// ── Settings (browser-only, no DB) ──────────────────────────────────────────

app.get("/api/settings", (req: Request, res: Response) => {
  const c = parseConfig(req);
  res.json(c);
});

app.put("/api/settings", (req: Request, res: Response) => {
  res.json({ success: true });
});

app.delete("/api/settings/:key", (req: Request, res: Response) => {
  res.json({ success: true });
});

// ── Billing ──────────────────────────────────────────────────────────────────

app.get("/api/billing", async (req: Request, res: Response) => {
  try {
    const { accountApiKey } = getConfig(req);
    if (!accountApiKey) {
      return res.status(500).json({ message: "Account API key not configured. Add it in Settings." });
    }
    const headers = { AccessKey: accountApiKey, accept: "application/json" };
    const [billingRes, userRes] = await Promise.all([
      fetch("https://api.bunny.net/billing", { headers }),
      fetch("https://api.bunny.net/user", { headers }),
    ]);
    if (!billingRes.ok) {
      return res.status(billingRes.status).json({ message: await billingRes.text() });
    }
    const billingData = await billingRes.json();
    let userData: any = {};
    if (userRes.ok) userData = await userRes.json();
    return res.json({
      ...billingData,
      TrialBalance: userData.TrialBalance ?? null,
      BillingFreeUntilDate: userData.BillingFreeUntilDate ?? null,
      DateJoined: userData.DateJoined ?? null,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Collections ───────────────────────────────────────────────────────────────

app.get("/api/collections", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) {
      return res.status(500).json({ message: "Bunny API credentials not configured. Go to Settings to add them." });
    }
    const r = await fetch(
      `${BUNNY_API_URL}/library/${libraryId}/collections?page=1&itemsPerPage=100&orderBy=date`,
      { headers: bunnyHeaders(apiKey) }
    );
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json(await r.json());
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.post("/api/collections", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    const r = await fetch(`${BUNNY_API_URL}/library/${libraryId}/collections`, {
      method: "POST",
      headers: bunnyHeaders(apiKey, "application/json"),
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json(await r.json());
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.delete("/api/collections/:id", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });
    const r = await fetch(`${BUNNY_API_URL}/library/${libraryId}/collections/${req.params.id}`, {
      method: "DELETE",
      headers: bunnyHeaders(apiKey),
    });
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Videos ────────────────────────────────────────────────────────────────────

app.get("/api/videos/:collectionFilter", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });
    const collectionFilter = req.params.collectionFilter;
    let url = `${BUNNY_API_URL}/library/${libraryId}/videos?page=1&itemsPerPage=100&orderBy=date`;
    if (collectionFilter && collectionFilter !== "all") url += `&collection=${collectionFilter}`;
    const r = await fetch(url, { headers: bunnyHeaders(apiKey) });
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json(await r.json());
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.post("/api/videos", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });
    const { title, collectionId } = req.body;
    if (!title) return res.status(400).json({ message: "Title is required" });
    const body: any = { title };
    if (collectionId) body.collectionId = collectionId;
    const r = await fetch(`${BUNNY_API_URL}/library/${libraryId}/videos`, {
      method: "POST",
      headers: bunnyHeaders(apiKey, "application/json"),
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json(await r.json());
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/upload-config", (req: Request, res: Response) => {
  const { apiKey, libraryId } = getConfig(req);
  if (!apiKey || !libraryId) {
    return res.status(500).json({ message: "Bunny API credentials not configured" });
  }
  return res.json({ apiUrl: BUNNY_API_URL, libraryId, apiKey });
});

app.post("/api/videos/:videoId/move", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });
    const { collectionId } = req.body;
    const r = await fetch(`${BUNNY_API_URL}/library/${libraryId}/videos/${req.params.videoId}`, {
      method: "POST",
      headers: bunnyHeaders(apiKey, "application/json"),
      body: JSON.stringify({ collectionId: collectionId || "" }),
    });
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json(await r.json());
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.delete("/api/videos/:videoId", async (req: Request, res: Response) => {
  try {
    const { apiKey, libraryId } = getConfig(req);
    if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });
    const r = await fetch(`${BUNNY_API_URL}/library/${libraryId}/videos/${req.params.videoId}`, {
      method: "DELETE",
      headers: bunnyHeaders(apiKey),
    });
    if (!r.ok) return res.status(r.status).json({ message: await r.text() });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── EvoStream API Push proxy ──────────────────────────────────────────────────

app.post("/api/evo-push", async (req: Request, res: Response) => {
  try {
    const { url, evoKey, evoServer, evoDisk, evoEncode } = req.body;
    if (!url || !evoKey) return res.status(400).json({ message: "url and evoKey are required" });
    const target = `https://evostream.top/api/addVideo.php?key=${encodeURIComponent(evoKey)}&url=${encodeURIComponent(url)}&server=${encodeURIComponent(evoServer ?? "1")}&disk=${encodeURIComponent(evoDisk ?? "0")}&encode=${encodeURIComponent(evoEncode ?? "0")}`;
    const r = await fetch(target);
    const text = await r.text();
    return res.json({ status: r.status, ok: r.ok, body: text });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({ message: err.message || "Internal Server Error" });
});

// ── Vercel handler ────────────────────────────────────────────────────────────

export default function handler(req: Request, res: Response) {
  return app(req, res);
}
