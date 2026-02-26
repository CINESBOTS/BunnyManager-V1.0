import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { settings } from "@shared/schema";
import { eq } from "drizzle-orm";

const BUNNY_API_URL = "https://video.bunnycdn.com";

function parseConfigHeader(req: Request): Record<string, string> {
  const header = req.headers["x-bunny-config"];
  if (!header || typeof header !== "string") return {};
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

async function getSetting(key: string): Promise<string | null> {
  if (!db) return null;
  try {
    const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return result.length > 0 ? result[0].value : null;
  } catch {
    return null;
  }
}

async function getApiConfig(req: Request) {
  const hdr = parseConfigHeader(req);
  const apiKey = hdr["api_key"] || (await getSetting("api_key"));
  const libraryId = hdr["library_id"] || (await getSetting("library_id"));
  const downloadDomain = hdr["download_domain"] || (await getSetting("download_domain"));
  return { apiKey, libraryId, downloadDomain };
}

async function getAccountApiKey(req: Request): Promise<string | null> {
  const hdr = parseConfigHeader(req);
  return hdr["account_api_key"] || (await getSetting("account_api_key"));
}

function getBunnyHeaders(apiKey: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    AccessKey: apiKey,
    accept: "application/json",
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ===== Settings =====

  app.get("/api/settings", async (req: Request, res: Response) => {
    const hdr = parseConfigHeader(req);
    const result: Record<string, string> = {};
    if (db) {
      try {
        const allSettings = await db.select().from(settings);
        for (const s of allSettings) result[s.key] = s.value;
      } catch {}
    }
    for (const k of ["api_key", "library_id", "download_domain", "account_api_key"] as const) {
      if (hdr[k]) result[k] = hdr[k];
    }
    res.json(result);
  });

  app.put("/api/settings", async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body;
      if (!key || typeof key !== "string") return res.status(400).json({ message: "Key is required" });
      if (!value || typeof value !== "string") return res.status(400).json({ message: "Value is required" });
      const validKeys = ["api_key", "library_id", "download_domain", "account_api_key"];
      if (!validKeys.includes(key)) return res.status(400).json({ message: "Invalid setting key" });
      if (db) {
        const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
        if (existing.length > 0) {
          await db.update(settings).set({ value }).where(eq(settings.key, key));
        } else {
          await db.insert(settings).values({ key, value });
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/settings/:key", async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      if (db) await db.delete(settings).where(eq(settings.key, key));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ===== Billing =====

  app.get("/api/billing", async (req: Request, res: Response) => {
    try {
      const accountApiKey = await getAccountApiKey(req);
      if (!accountApiKey) return res.status(500).json({ message: "Account API key not configured. Add it in Settings." });

      const headers = { AccessKey: accountApiKey, accept: "application/json" };

      const [billingRes, userRes] = await Promise.all([
        fetch("https://api.bunny.net/billing", { headers }),
        fetch("https://api.bunny.net/user", { headers }),
      ]);

      if (!billingRes.ok) {
        const text = await billingRes.text();
        return res.status(billingRes.status).json({ message: text });
      }

      const billingData = await billingRes.json();
      let userData: any = {};
      if (userRes.ok) {
        userData = await userRes.json();
      }

      res.json({
        ...billingData,
        TrialBalance: userData.TrialBalance ?? null,
        BillingFreeUntilDate: userData.BillingFreeUntilDate ?? null,
        DateJoined: userData.DateJoined ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ===== Collections =====

  app.get("/api/collections", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured. Go to Settings to add them." });

      const response = await fetch(
        `${BUNNY_API_URL}/library/${libraryId}/collections?page=1&itemsPerPage=100&orderBy=date`,
        { headers: getBunnyHeaders(apiKey) }
      );
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/collections", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      const { name } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });

      const response = await fetch(
        `${BUNNY_API_URL}/library/${libraryId}/collections`,
        {
          method: "POST",
          headers: getBunnyHeaders(apiKey, "application/json"),
          body: JSON.stringify({ name }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/collections/:id", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      const response = await fetch(
        `${BUNNY_API_URL}/library/${libraryId}/collections/${req.params.id}`,
        {
          method: "DELETE",
          headers: getBunnyHeaders(apiKey),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ===== Videos =====

  app.get("/api/videos/:collectionFilter", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      const collectionFilter = req.params.collectionFilter;
      let url = `${BUNNY_API_URL}/library/${libraryId}/videos?page=1&itemsPerPage=100&orderBy=date`;
      if (collectionFilter && collectionFilter !== "all") {
        url += `&collection=${collectionFilter}`;
      }

      const response = await fetch(url, { headers: getBunnyHeaders(apiKey) });
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/videos", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      const { title, collectionId } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });

      const body: any = { title };
      if (collectionId) body.collectionId = collectionId;

      const response = await fetch(
        `${BUNNY_API_URL}/library/${libraryId}/videos`,
        {
          method: "POST",
          headers: getBunnyHeaders(apiKey, "application/json"),
          body: JSON.stringify(body),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/upload-config", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      res.json({
        apiUrl: BUNNY_API_URL,
        libraryId,
        apiKey,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/videos/:videoId/move", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      const { collectionId } = req.body;
      const response = await fetch(
        `${BUNNY_API_URL}/library/${libraryId}/videos/${req.params.videoId}`,
        {
          method: "POST",
          headers: getBunnyHeaders(apiKey, "application/json"),
          body: JSON.stringify({ collectionId: collectionId || "" }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/videos/:videoId", async (req: Request, res: Response) => {
    try {
      const { apiKey, libraryId } = await getApiConfig(req);
      if (!apiKey || !libraryId) return res.status(500).json({ message: "Bunny API credentials not configured" });

      const response = await fetch(
        `${BUNNY_API_URL}/library/${libraryId}/videos/${req.params.videoId}`,
        {
          method: "DELETE",
          headers: getBunnyHeaders(apiKey),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ message: text });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
