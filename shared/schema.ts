import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const insertSettingSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;

export const bunnyCollectionSchema = z.object({
  videoLibraryId: z.number(),
  guid: z.string(),
  name: z.string(),
  videoCount: z.number(),
  totalSize: z.number(),
  previewVideoIds: z.string().nullable().optional(),
});

export type BunnyCollection = z.infer<typeof bunnyCollectionSchema>;

export const createCollectionSchema = z.object({
  name: z.string().min(1, "Collection name is required"),
});

export type CreateCollection = z.infer<typeof createCollectionSchema>;

export const bunnyVideoSchema = z.object({
  videoLibraryId: z.number(),
  guid: z.string(),
  title: z.string(),
  dateUploaded: z.string(),
  views: z.number(),
  isPublic: z.boolean(),
  length: z.number(),
  status: z.number(),
  framerate: z.number().optional(),
  rotation: z.number().optional().nullable(),
  width: z.number().optional(),
  height: z.number().optional(),
  availableResolutions: z.string().optional().nullable(),
  thumbnailCount: z.number().optional(),
  encodeProgress: z.number().optional(),
  storageSize: z.number().optional(),
  captions: z.array(z.any()).optional(),
  hasMP4Fallback: z.boolean().optional(),
  collectionId: z.string().optional().nullable(),
  thumbnailFileName: z.string().optional(),
  averageWatchTime: z.number().optional(),
  totalWatchTime: z.number().optional(),
  category: z.string().optional().nullable(),
  chapters: z.array(z.any()).optional(),
  moments: z.array(z.any()).optional(),
  metaTags: z.array(z.any()).optional(),
  transcodingMessages: z.array(z.any()).optional(),
});

export type BunnyVideo = z.infer<typeof bunnyVideoSchema>;

export const uploadQueueItemSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  status: z.enum(["pending", "uploading", "processing", "complete", "error", "skipped"]),
  progress: z.number(),
  error: z.string().optional(),
  videoId: z.string().optional(),
  collectionId: z.string().optional(),
});

export type UploadQueueItem = z.infer<typeof uploadQueueItemSchema>;

export interface BunnyVideoListResponse {
  totalItems: number;
  currentPage: number;
  itemsPerPage: number;
  items: BunnyVideo[];
}

export interface BunnyCollectionListResponse {
  totalItems: number;
  currentPage: number;
  itemsPerPage: number;
  items: BunnyCollection[];
}

export type User = { id: string; username: string; password: string };
export type InsertUser = { username: string; password: string };
