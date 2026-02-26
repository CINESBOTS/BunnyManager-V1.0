import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { db } from "../server/db";
import { settings } from "../shared/schema";
import { eq } from "drizzle-orm";
import { registerRoutes } from "../server/routes";

const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

let initialized = false;

async function init() {
  if (initialized) return;

  const envMappings: [string, string | undefined][] = [
    ["api_key", process.env.BUNNY_API_KEY],
    ["library_id", process.env.BUNNY_LIBRARY_ID],
  ];
  for (const [key, envValue] of envMappings) {
    if (!envValue) continue;
    try {
      const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (existing.length === 0) {
        await db.insert(settings).values({ key, value: envValue });
      }
    } catch {}
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  initialized = true;
}

export default async function handler(req: Request, res: Response) {
  await init();
  return app(req, res);
}
