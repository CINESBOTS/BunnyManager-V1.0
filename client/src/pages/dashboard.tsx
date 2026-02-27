import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getLocalSettings } from "@/lib/localSettings";
import { useToast } from "@/hooks/use-toast";
import type { BunnyCollection, BunnyVideo, BunnyVideoListResponse, BunnyCollectionListResponse, UploadQueueItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FolderOpen, Upload, Plus, Trash2, Video, Clock, Eye, HardDrive,
  RefreshCw, CheckCircle2, XCircle, Loader2, FileVideo, FolderSync,
  LayoutGrid, List, Search, AlertTriangle, CloudUpload, FolderInput,
  ChevronRight, Play, Pause, SkipForward, Film, Percent, Copy, ClipboardCheck,
  Settings, CreditCard, ArrowRightLeft, FolderMinus, CheckSquare, Download, X, Info, Captions
} from "lucide-react";
import { Link } from "wouter";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getStatusText(status: number): string {
  switch (status) {
    case 0: return "Created";
    case 1: return "Uploaded";
    case 2: return "Processing";
    case 3: return "Transcoding";
    case 4: return "Finished";
    case 5: return "Error";
    case 6: return "Encoding";
    default: return "Unknown";
  }
}

function getStatusBadge(status: number) {
  switch (status) {
    case 0: return <Badge variant="secondary" data-testid="badge-status-created">Created</Badge>;
    case 1: return <Badge variant="secondary" data-testid="badge-status-uploaded">Uploaded</Badge>;
    case 2: return <Badge variant="secondary" data-testid="badge-status-processing">Processing</Badge>;
    case 3: return <Badge variant="secondary" data-testid="badge-status-transcoding">Transcoding</Badge>;
    case 4: return <Badge data-testid="badge-status-finished">Finished</Badge>;
    case 5: return <Badge variant="destructive" data-testid="badge-status-error">Error</Badge>;
    case 6: return <Badge variant="secondary" data-testid="badge-status-encoding">Encoding</Badge>;
    default: return <Badge variant="secondary" data-testid="badge-status-unknown">Unknown</Badge>;
  }
}

export default function Dashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [matchRoute, params] = useRoute("/collections/:collectionName");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [watchedFolder, setWatchedFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [watchedFolderName, setWatchedFolderName] = useState<string>("");
  const [knownFiles, setKnownFiles] = useState<Map<string, { size: number; stableCount: number; lastModified: number; queued?: boolean }>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scanFolderRef = useRef<() => void>(() => {});
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const uploadedRegistry = useRef<Set<string>>(new Set());
  const [burnSubtitles, setBurnSubtitlesRaw] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem("bunny_burn_subtitles");
      return s === null ? true : s === "true";
    } catch { return true; }
  });
  const burnSubtitlesRef = useRef(burnSubtitles);
  const setBurnSubtitles = (v: boolean) => {
    burnSubtitlesRef.current = v;
    setBurnSubtitlesRaw(v);
    try { localStorage.setItem("bunny_burn_subtitles", String(v)); } catch {}
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem("bunny_uploaded_files");
      if (stored) {
        uploadedRegistry.current = new Set(JSON.parse(stored) as string[]);
      }
    } catch {}
  }, []);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetCollection, setMoveTargetCollection] = useState<string>("");
  const [playingVideo, setPlayingVideo] = useState<BunnyVideo | null>(null);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);

  const collectionsQuery = useQuery<BunnyCollectionListResponse>({
    queryKey: ["/api/collections"],
    refetchInterval: 60000,
  });

  const collections = collectionsQuery.data?.items || [];
  const urlCollectionSlug = matchRoute ? params?.collectionName : null;

  const selectedCollection = useMemo(() => {
    if (!urlCollectionSlug || collections.length === 0) return null;
    const decoded = decodeURIComponent(urlCollectionSlug);
    const found = collections.find(c => c.name === decoded);
    return found?.guid || null;
  }, [urlCollectionSlug, collections]);

  const setSelectedCollection = useCallback((guid: string | null) => {
    if (!guid) {
      setLocation("/");
      return;
    }
    const col = collections.find(c => c.guid === guid);
    if (col) {
      setLocation(`/collections/${encodeURIComponent(col.name)}`);
    }
  }, [collections, setLocation]);

  useEffect(() => {
    setSelectedVideos(new Set());
  }, [selectedCollection]);

  const uploadConfigQuery = useQuery<{ libraryId: string }>({
    queryKey: ["/api/upload-config"],
  });

  const rawDownloadDomain = (getLocalSettings().download_domain || "");
  const downloadDomain = rawDownloadDomain.replace(/^https?:\/\//, "");

  const billingQuery = useQuery<{ Balance: number; TrialBalance?: number; BillingFreeUntilDate?: string; MonthlyChargesStorage?: number; MonthlyChargesEUTraffic?: number; MonthlyChargesUSTraffic?: number; MonthlyChargesASIATraffic?: number; MonthlyChargesSATraffic?: number; MonthlyChargesAFTraffic?: number; MonthlyChargesOCTraffic?: number }>({
    queryKey: ["/api/billing"],
  });

  const [iframeLinksCopied, setIframeLinksCopied] = useState(false);
  const [downloadLinksCopied, setDownloadLinksCopied] = useState(false);

  const collectionFilter = selectedCollection || "all";
  const videosQuery = useQuery<BunnyVideoListResponse>({
    queryKey: ["/api/videos", collectionFilter],
    queryFn: async () => {
      const { buildConfigHeader } = await import("@/lib/localSettings");
      const res = await fetch(`/api/videos/${collectionFilter}`, {
        credentials: "include",
        headers: buildConfigHeader(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 60000,
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/collections", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      setNewCollectionName("");
      setCreateDialogOpen(false);
      toast({ title: "Collection created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create collection", description: err.message, variant: "destructive" });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/collections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      if (selectedCollection) setSelectedCollection(null);
      toast({ title: "Collection deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete collection", description: err.message, variant: "destructive" });
    },
  });

  const deleteVideoMutation = useMutation({
    mutationFn: async (videoId: string) => {
      await apiRequest("DELETE", `/api/videos/${videoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Video deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete video", description: err.message, variant: "destructive" });
    },
  });

  const moveVideoMutation = useMutation({
    mutationFn: async ({ videoId, collectionId }: { videoId: string; collectionId: string }) => {
      await apiRequest("POST", `/api/videos/${videoId}/move`, { collectionId });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to move video", description: err.message, variant: "destructive" });
    },
  });

  const toggleVideoSelection = useCallback((videoId: string) => {
    setSelectedVideos(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }, []);

  const selectAllFilteredVideos = useCallback((videoList: BunnyVideo[]) => {
    if (selectedVideos.size === videoList.length && videoList.every(v => selectedVideos.has(v.guid))) {
      setSelectedVideos(new Set());
    } else {
      setSelectedVideos(new Set(videoList.map(v => v.guid)));
    }
  }, [selectedVideos]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedVideos);
    for (const id of ids) {
      await apiRequest("DELETE", `/api/videos/${id}`);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    setSelectedVideos(new Set());
    toast({ title: `${ids.length} video${ids.length > 1 ? "s" : ""} deleted` });
  }, [selectedVideos, toast]);

  const handleBulkMove = useCallback(async (targetCollectionId: string) => {
    const ids = Array.from(selectedVideos);
    for (const id of ids) {
      await apiRequest("POST", `/api/videos/${id}/move`, { collectionId: targetCollectionId });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    setSelectedVideos(new Set());
    setMoveDialogOpen(false);
    setMoveTargetCollection("");
    const targetName = collections.find(c => c.guid === targetCollectionId)?.name || "collection";
    toast({ title: `${ids.length} video${ids.length > 1 ? "s" : ""} moved to ${targetName}` });
  }, [selectedVideos, collections, toast]);

  const handleRemoveFromCollection = useCallback(async () => {
    const ids = Array.from(selectedVideos);
    for (const id of ids) {
      await apiRequest("POST", `/api/videos/${id}/move`, { collectionId: "" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    setSelectedVideos(new Set());
    toast({ title: `${ids.length} video${ids.length > 1 ? "s" : ""} removed from collection` });
  }, [selectedVideos, toast]);

  const getCleanTitle = useCallback((fileName: string): string => {
    return fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[\s_]+/g, " ")
      .trim()
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .replace(/[<>:"|?*\\]/g, "-")
      .substring(0, 100) || "untitled";
  }, []);

  const addToUploadedRegistry = useCallback((fileName: string, collectionId: string | null) => {
    const key = `${collectionId || ""}:${getCleanTitle(fileName).toLowerCase()}`;
    uploadedRegistry.current.add(key);
    try {
      localStorage.setItem("bunny_uploaded_files", JSON.stringify(Array.from(uploadedRegistry.current)));
    } catch {}
  }, [getCleanTitle]);

  const isInUploadedRegistry = useCallback((fileName: string, collectionId: string | null) => {
    const key = `${collectionId || ""}:${getCleanTitle(fileName).toLowerCase()}`;
    return uploadedRegistry.current.has(key);
  }, [getCleanTitle]);

  const isVideoDuplicate = useCallback((fileName: string, collectionId: string | null = selectedCollection) => {
    if (isInUploadedRegistry(fileName, collectionId)) return true;
    const existingVideos = videosQuery.data?.items || [];
    const cleanTitle = getCleanTitle(fileName);
    return existingVideos.some(v =>
      v.title.toLowerCase() === cleanTitle.toLowerCase() ||
      v.title.toLowerCase() === fileName.toLowerCase()
    );
  }, [videosQuery.data, getCleanTitle, isInUploadedRegistry, selectedCollection]);

  const uploadFile = useCallback(async (file: File, collectionId: string | null, subtitleFile?: File) => {
    const queueId = crypto.randomUUID();
    const queueItem: UploadQueueItem = {
      id: queueId,
      fileName: file.name,
      fileSize: file.size,
      status: "pending",
      progress: 0,
      collectionId: collectionId || undefined,
    };

    // Register immediately so duplicate checks in subsequent sync scans catch it
    addToUploadedRegistry(file.name, collectionId);
    setUploadQueue(prev => [...prev, queueItem]);

    try {
      setUploadQueue(prev => prev.map(item =>
        item.id === queueId ? { ...item, status: "uploading" as const, progress: 5 } : item
      ));

      const { buildConfigHeader } = await import("@/lib/localSettings");
      const configRes = await fetch("/api/upload-config", { headers: buildConfigHeader() });
      if (!configRes.ok) throw new Error("Failed to get upload config");
      const config = await configRes.json();

      setUploadQueue(prev => prev.map(item =>
        item.id === queueId ? { ...item, progress: 10 } : item
      ));

      const cleanTitle = getCleanTitle(file.name);

      const createRes = await fetch(`${config.apiUrl}/library/${config.libraryId}/videos`, {
        method: "POST",
        headers: {
          AccessKey: config.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          title: cleanTitle,
          collectionId: collectionId || undefined,
        }),
      });

      if (!createRes.ok) {
        const errorText = await createRes.text();
        throw new Error(`Failed to create video: ${createRes.status} - ${errorText}`);
      }

      const videoData = await createRes.json();

      setUploadQueue(prev => prev.map(item =>
        item.id === queueId ? { ...item, progress: 20, videoId: videoData.guid } : item
      ));

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${config.apiUrl}/library/${config.libraryId}/videos/${videoData.guid}`, true);
      xhr.setRequestHeader("AccessKey", config.apiKey);
      xhr.setRequestHeader("Content-Type", "video/mp4");
      xhr.timeout = Math.max(300000, (file.size / (100 * 1024 * 1024)) * 300000);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round(20 + (e.loaded / e.total) * 75);
          setUploadQueue(prev => prev.map(item =>
            item.id === queueId ? { ...item, progress: pct } : item
          ));
        }
      };

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.ontimeout = () => reject(new Error("Upload timeout"));
        xhr.send(file);
      });

      if (burnSubtitlesRef.current && subtitleFile) {
        try {
          const subtitleText = await subtitleFile.text();
          const blob = new Blob([subtitleText], { type: "text/plain" });
          const form = new FormData();
          form.append("captionsFile", blob, subtitleFile.name);
          await fetch(`${config.apiUrl}/library/${config.libraryId}/videos/${videoData.guid}/captions/en`, {
            method: "PUT",
            headers: { AccessKey: config.apiKey },
            body: form,
          });
        } catch {
          // subtitle upload failed silently — don't fail the whole upload
        }
      }

      setUploadQueue(prev => prev.map(item =>
        item.id === queueId ? { ...item, status: "complete" as const, progress: 100 } : item
      ));

      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    } catch (err: any) {
      setUploadQueue(prev => prev.map(item =>
        item.id === queueId ? { ...item, status: "error" as const, error: err.message } : item
      ));
    }
  }, [addToUploadedRegistry]);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const videoExtensions = [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".ts"];
    const subtitleExtensions = [".srt", ".vtt", ".ass"];

    const subtitleMap = new Map<string, File>();
    const videoFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (subtitleExtensions.includes(ext)) {
        const base = file.name.slice(0, file.name.lastIndexOf(".")).toLowerCase();
        subtitleMap.set(base, file);
      } else {
        videoFiles.push(file);
      }
    }

    let skippedCount = 0;
    for (const file of videoFiles) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      const base = file.name.slice(0, file.name.lastIndexOf(".")).toLowerCase();
      const subtitleFile = subtitleMap.get(base);
      const alreadyInQueue = uploadQueue.some(
        q => q.fileName === file.name && (q.status === "uploading" || q.status === "pending" || q.status === "complete")
      );
      if (!videoExtensions.includes(ext)) {
        setUploadQueue(prev => [...prev, {
          id: crypto.randomUUID(),
          fileName: file.name,
          fileSize: file.size,
          status: "skipped",
          progress: 0,
          error: "Not a video file",
        }]);
      } else if (alreadyInQueue || isInUploadedRegistry(file.name, selectedCollection)) {
        skippedCount++;
        setUploadQueue(prev => [...prev, {
          id: crypto.randomUUID(),
          fileName: file.name,
          fileSize: file.size,
          status: "skipped",
          progress: 0,
          error: "Already uploaded to this collection",
        }]);
      } else {
        addToUploadedRegistry(file.name, selectedCollection);
        uploadFile(file, selectedCollection, subtitleFile);
      }
    }
    if (skippedCount > 0) {
      toast({ title: `${skippedCount} file(s) skipped`, description: "Already uploaded to this collection" });
    }
  }, [selectedCollection, uploadFile, isInUploadedRegistry, addToUploadedRegistry, uploadQueue, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const selectWatchFolder = useCallback(async () => {
    try {
      if (!("showDirectoryPicker" in window)) {
        toast({ title: "Folder watching not supported", description: "Please use Chrome or Edge browser for auto-sync feature", variant: "destructive" });
        return;
      }
      const dirHandle = await (window as any).showDirectoryPicker({ mode: "read" });
      setWatchedFolder(dirHandle);
      setWatchedFolderName(dirHandle.name);
      setKnownFiles(new Map<string, { size: number; stableCount: number; lastModified: number }>());
      setAutoSyncEnabled(false);
      toast({ title: "Folder selected", description: `Watching: ${dirHandle.name}` });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({ title: "Failed to select folder", description: err.message, variant: "destructive" });
      }
    }
  }, [toast]);

  // Check if a video file is complete by reading its duration metadata.
  // An incomplete Handbrake file has no moov atom yet → duration is 0, NaN, or Infinity.
  const checkFileHasDuration = (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";

      const cleanup = () => {
        URL.revokeObjectURL(url);
        video.removeAttribute("src");
        video.load();
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(false); // Can't read metadata within 8s → treat as incomplete
      }, 8000);

      video.onloadedmetadata = () => {
        clearTimeout(timer);
        const valid = isFinite(video.duration) && video.duration > 0;
        cleanup();
        resolve(valid);
      };

      video.onerror = () => {
        clearTimeout(timer);
        cleanup();
        resolve(false);
      };

      video.src = url;
    });
  };

  const scanFolder = useCallback(async () => {
    if (!watchedFolder || !selectedCollection) return;

    const MIN_STABLE_CHECKS = 3;
    const MIN_AGE_MS = 60000;

    // Extensions that indicate incomplete/temp files (Handbrake, browsers, etc.)
    const TEMP_EXTENSIONS = [".tmp", ".part", ".crdownload", ".download", ".partial", ".temp", ".incomplete"];

    try {
      const currentFiles = new Map<string, { size: number; lastModified: number }>();
      const subtitleFiles = new Map<string, File>();
      const videoExtensions = [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".ts"];
      const subtitleExtensions = [".srt", ".vtt", ".ass"];

      for await (const entry of (watchedFolder as any).values()) {
        if (entry.kind === "file") {
          const nameLower = entry.name.toLowerCase();
          if (TEMP_EXTENSIONS.some(t => nameLower.endsWith(t))) continue;
          if (nameLower.startsWith("~") || nameLower.startsWith(".")) continue;
          const ext = "." + nameLower.split(".").pop();
          if (videoExtensions.includes(ext)) {
            try {
              const file = await entry.getFile();
              currentFiles.set(entry.name, { size: file.size, lastModified: file.lastModified });
            } catch {
              // File might be locked/in-use — skip
            }
          } else if (subtitleExtensions.includes(ext)) {
            try {
              const file = await entry.getFile();
              const base = entry.name.slice(0, entry.name.lastIndexOf(".")).toLowerCase();
              subtitleFiles.set(base, file);
            } catch {}
          }
        }
      }

      const newFilesToUpload: { file: File; subtitle?: File }[] = [];
      const updatedKnown = new Map(knownFiles);

      for (const [name, { size, lastModified }] of Array.from(currentFiles.entries())) {
        const previous = updatedKnown.get(name);

        if (!previous) {
          updatedKnown.set(name, { size, stableCount: 0, lastModified });
        } else if (previous.queued) {
          updatedKnown.set(name, { ...previous });
        } else if (previous.size === size && previous.lastModified === lastModified && size > 0) {
          // Both size AND lastModified are unchanged — file is stable
          const newStableCount = previous.stableCount + 1;
          updatedKnown.set(name, { size, stableCount: newStableCount, lastModified });

          const fileAge = Date.now() - lastModified;
          if (newStableCount >= MIN_STABLE_CHECKS && fileAge >= MIN_AGE_MS) {
            const alreadyQueued = uploadQueue.some(
              item => item.fileName === name && (item.status === "uploading" || item.status === "complete" || item.status === "pending")
            );
            const alreadyInRegistry = isInUploadedRegistry(name, selectedCollection);
            if (!alreadyQueued && !alreadyInRegistry) {
              try {
                for await (const entry of (watchedFolder as any).values()) {
                  if (entry.kind === "file" && entry.name === name) {
                    const file = await entry.getFile();
                    const hasValidDuration = await checkFileHasDuration(file);
                    if (!hasValidDuration) {
                      updatedKnown.set(name, { size, stableCount: 0, lastModified });
                      break;
                    }
                    const videoBase = name.slice(0, name.lastIndexOf(".")).toLowerCase();
                    const subtitle = subtitleFiles.get(videoBase);
                    addToUploadedRegistry(name, selectedCollection);
                    updatedKnown.set(name, { size, stableCount: newStableCount, lastModified, queued: true });
                    newFilesToUpload.push({ file, subtitle });
                    break;
                  }
                }
              } catch {
                // File access error
              }
            }
          }
        } else {
          // Size or lastModified changed — file is still being written, reset counter
          updatedKnown.set(name, { size, stableCount: 0, lastModified });
        }
      }

      setKnownFiles(updatedKnown);

      for (const { file, subtitle } of newFilesToUpload) {
        uploadFile(file, selectedCollection, subtitle);
      }

      if (newFilesToUpload.length > 0) {
        toast({ title: `Auto-sync: ${newFilesToUpload.length} file(s) queued` });
      }
    } catch (err: any) {
      console.error("Folder scan error:", err);
      toast({ title: "Auto-sync scan failed", description: "Folder access may have been revoked", variant: "destructive" });
      setAutoSyncEnabled(false);
    }
  }, [watchedFolder, selectedCollection, knownFiles, uploadQueue, uploadFile, isInUploadedRegistry, addToUploadedRegistry, toast]);

  useEffect(() => { scanFolderRef.current = scanFolder; });

  useEffect(() => {
    if (!autoSyncEnabled || !watchedFolder || !selectedCollection) {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
      return;
    }
    scanFolderRef.current();
    autoSyncIntervalRef.current = setInterval(() => scanFolderRef.current(), 60000);
    return () => {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
    };
  }, [autoSyncEnabled, watchedFolder, selectedCollection]);

  const videos = videosQuery.data?.items || [];
  const filteredVideos = searchQuery
    ? videos.filter(v => v.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : videos;

  const selectedCollectionData = collections.find(c => c.guid === selectedCollection);

  const completedUploads = uploadQueue.filter(i => i.status === "complete").length;
  const activeUploads = uploadQueue.filter(i => i.status === "uploading").length;

  const clearCompletedUploads = () => {
    setUploadQueue(prev => prev.filter(item => item.status !== "complete" && item.status !== "error" && item.status !== "skipped"));
  };

  // Auto-clear upload queue 4 seconds after all uploads finish
  useEffect(() => {
    if (uploadQueue.length === 0) return;
    const hasActive = uploadQueue.some(i => i.status === "uploading" || i.status === "pending");
    if (hasActive) return;
    const timer = setTimeout(() => {
      setUploadQueue([]);
    }, 4000);
    return () => clearTimeout(timer);
  }, [uploadQueue]);

  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar */}
      <aside className="w-72 border-r flex flex-col bg-sidebar">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <Film className="w-5 h-5 text-primary" />
              <h1 className="text-base font-semibold text-sidebar-foreground">Bunny Stream</h1>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/settings">
                  <Button size="icon" variant="ghost" data-testid="button-settings">
                    <Settings className="w-4 h-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">Video Manager</p>
        </div>

        <div className="p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Collections</span>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" data-testid="button-create-collection">
                  <Plus className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Collection</DialogTitle>
                </DialogHeader>
                <Input
                  placeholder="Collection name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCollectionName.trim()) {
                      createCollectionMutation.mutate(newCollectionName.trim());
                    }
                  }}
                  data-testid="input-collection-name"
                />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" data-testid="button-cancel-create">Cancel</Button>
                  </DialogClose>
                  <Button
                    onClick={() => createCollectionMutation.mutate(newCollectionName.trim())}
                    disabled={!newCollectionName.trim() || createCollectionMutation.isPending}
                    data-testid="button-confirm-create"
                  >
                    {createCollectionMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <ScrollArea className="h-[calc(100vh-380px)]">
            <div className="space-y-0.5">
              <button
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                  selectedCollection === null ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover-elevate"
                }`}
                onClick={() => setSelectedCollection(null)}
                data-testid="button-all-videos"
              >
                <Video className="w-4 h-4 shrink-0" />
                <span className="truncate">All Videos</span>
                <span className="ml-auto text-xs text-muted-foreground">{videosQuery.data?.totalItems || 0}</span>
              </button>

              {collectionsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                collections.map((col) => (
                  <div key={col.guid} className="group flex items-center">
                    <button
                      className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                        selectedCollection === col.guid ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover-elevate"
                      }`}
                      onClick={() => setSelectedCollection(col.guid)}
                      data-testid={`button-collection-${col.guid}`}
                    >
                      <FolderOpen className="w-4 h-4 shrink-0" />
                      <span className="truncate">{col.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{col.videoCount}</span>
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 shrink-0"
                          data-testid={`button-delete-collection-${col.guid}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{col.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete this collection. Videos inside may also be affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteCollectionMutation.mutate(col.guid)}
                            className="bg-destructive text-destructive-foreground"
                            data-testid="button-confirm-delete"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {billingQuery.data && (
          <div className="px-3 pb-3">
            <div className="rounded-md bg-card p-3 space-y-2" data-testid="sidebar-billing">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Balance</span>
                </div>
                <span className="text-sm font-semibold" data-testid="text-sidebar-balance">
                  ${billingQuery.data.Balance?.toFixed(2) ?? "0.00"}
                </span>
              </div>
              {billingQuery.data.TrialBalance != null && billingQuery.data.TrialBalance > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Trial credits</span>
                    <span className="text-xs font-medium" data-testid="text-sidebar-trial-balance">
                      ${billingQuery.data.TrialBalance.toFixed(2)}
                    </span>
                  </div>
                  {billingQuery.data.BillingFreeUntilDate && (
                    <div className="text-xs text-muted-foreground" data-testid="text-sidebar-trial-date">
                      {(() => {
                        const endDate = new Date(billingQuery.data.BillingFreeUntilDate!);
                        const now = new Date();
                        const diffDays = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
                        return `Trial ends in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <Separator />

        {/* Auto-Sync Section */}
        <div className="p-3 mt-auto">
          <div className="flex items-center gap-2 mb-2">
            <FolderSync className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auto-Sync</span>
          </div>

          {watchedFolder ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-card text-sm">
                <FolderInput className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate text-xs">{watchedFolderName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={autoSyncEnabled ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    if (!selectedCollection) {
                      toast({ title: "Select a collection first", description: "Choose a collection to upload videos to", variant: "destructive" });
                      return;
                    }
                    setAutoSyncEnabled(!autoSyncEnabled);
                  }}
                  data-testid="button-toggle-autosync"
                >
                  {autoSyncEnabled ? <Pause className="w-3.5 h-3.5 mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                  {autoSyncEnabled ? "Pause" : "Start"}
                </Button>
                <Button size="sm" variant="outline" onClick={selectWatchFolder} data-testid="button-change-folder">
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
              {autoSyncEnabled && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Checking every 60 seconds...
                </p>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={selectWatchFolder}
              data-testid="button-select-watch-folder"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Select Watch Folder
            </Button>
          )}

          <div className="flex items-center justify-between mt-3 px-1 py-1.5 rounded-md">
            <div className="flex items-center gap-1.5">
              <Captions className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Burn Subtitles</span>
            </div>
            <button
              role="switch"
              aria-checked={burnSubtitles}
              onClick={() => setBurnSubtitles(!burnSubtitles)}
              data-testid="switch-burn-subtitles"
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${burnSubtitles ? "bg-primary" : "bg-input"}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${burnSubtitles ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs text-muted-foreground mt-1 h-7"
            data-testid="button-clear-upload-history"
            onClick={() => {
              uploadedRegistry.current = new Set();
              try { localStorage.removeItem("bunny_uploaded_files"); } catch {}
              toast({ title: "Upload history cleared" });
            }}
          >
            <X className="w-3 h-3 mr-1.5" />
            Clear Upload History
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b px-6 py-3 flex flex-col gap-2 bg-background sticky top-0 z-50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold" data-testid="text-current-view">
                {selectedCollectionData ? selectedCollectionData.name : "All Videos"}
              </h2>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search videos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-52"
                  data-testid="input-search-videos"
                />
              </div>

              <div className="flex border rounded-md">
                <Button
                  size="icon"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  onClick={() => setViewMode("grid")}
                  className="rounded-r-none"
                  data-testid="button-grid-view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  onClick={() => setViewMode("list")}
                  className="rounded-l-none"
                  data-testid="button-list-view"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/videos"], refetchType: "all" });
                  queryClient.invalidateQueries({ queryKey: ["/api/collections"], refetchType: "all" });
                  queryClient.invalidateQueries({ queryKey: ["/api/billing"], refetchType: "all" });
                  toast({ title: "Refreshed" });
                }}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 ${videosQuery.isFetching || collectionsQuery.isFetching ? "animate-spin" : ""}`} />
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
                data-testid="input-file-upload"
              />
              <Button onClick={() => fileInputRef.current?.click()} data-testid="button-upload-files">
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </Button>
            </div>
          </div>

          {selectedCollectionData && (() => {
            const videos = videosQuery.data?.items || [];
            const totalVideos = videos.length;
            const processingVideos = videos.filter(v => [0, 1, 2, 3, 6].includes(v.status)).length;
            const playReady = videos.filter(v => v.status === 4).length;
            return (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="secondary" data-testid="badge-total-videos">
                    <Film className="w-3 h-3 mr-1" /> Total: {totalVideos}
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-processing-videos">
                    <Loader2 className="w-3 h-3 mr-1" /> Processing: {processingVideos}
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-play-ready">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Play Ready: {playReady}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {uploadConfigQuery.data?.libraryId && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="button-copy-iframe-links"
                      onClick={() => {
                        const libraryId = uploadConfigQuery.data!.libraryId;
                        const links = videos
                          .map(v => `https://iframe.mediadelivery.net/play/${libraryId}/${v.guid}`)
                          .join("\n");
                        navigator.clipboard.writeText(links).then(() => {
                          setIframeLinksCopied(true);
                          toast({ title: `Copied ${videos.length} iframe links` });
                          setTimeout(() => setIframeLinksCopied(false), 2000);
                        });
                      }}
                    >
                      {iframeLinksCopied ? <ClipboardCheck className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                      {iframeLinksCopied ? "Copied" : "Copy Iframe Links"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="button-get-info"
                    onClick={() => setInfoDialogOpen(true)}
                  >
                    <Info className="w-4 h-4 mr-1.5" />
                    Get Info
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="button-copy-download-links"
                    onClick={() => {
                      const links = videos
                        .flatMap(v => [
                          `https://${downloadDomain}/${v.guid}/play_480p.mp4`,
                          `https://${downloadDomain}/${v.guid}/play_720p.mp4`,
                        ])
                        .join("\n");
                      navigator.clipboard.writeText(links).then(() => {
                        setDownloadLinksCopied(true);
                        toast({ title: `Copied ${videos.length * 2} download links (480p + 720p)` });
                        setTimeout(() => setDownloadLinksCopied(false), 2000);
                      });
                    }}
                  >
                    {downloadLinksCopied ? <ClipboardCheck className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    {downloadLinksCopied ? "Copied" : "Copy Download Links"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="button-download-links-txt"
                    onClick={() => {
                      const links = videos
                        .flatMap(v => [
                          `https://${downloadDomain}/${v.guid}/play_480p.mp4`,
                          `https://${downloadDomain}/${v.guid}/play_720p.mp4`,
                        ])
                        .join("\n");
                      const collectionName = selectedCollection
                        ? (collections.find(c => c.guid === selectedCollection)?.name ?? "collection")
                        : "all";
                      const blob = new Blob([links], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${collectionName}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast({ title: `Downloaded ${collectionName}.txt` });
                    }}
                  >
                    <Download className="w-4 h-4 mr-1.5" />
                    Download Links
                  </Button>
                </div>
              </div>
            );
          })()}
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          {/* Drop Zone */}
          <div
            className={`relative ${isDragOver ? "" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div className="absolute inset-0 z-40 bg-primary/5 border-2 border-dashed border-primary rounded-lg m-4 flex items-center justify-center">
                <div className="text-center">
                  <CloudUpload className="w-12 h-12 text-primary mx-auto mb-3" />
                  <p className="text-lg font-medium text-primary">Drop videos here to upload</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedCollectionData ? `Uploading to: ${selectedCollectionData.name}` : "Uploading to: All Videos"}
                  </p>
                </div>
              </div>
            )}

            <div className="p-6">
              {/* Upload Queue */}
              {uploadQueue.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <CloudUpload className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">Upload Queue</h3>
                      {activeUploads > 0 && (
                        <Badge variant="secondary">{activeUploads} active</Badge>
                      )}
                      {completedUploads > 0 && (
                        <Badge variant="secondary">{completedUploads} done</Badge>
                      )}
                      {activeUploads === 0 && uploadQueue.length > 0 && (
                        <span className="text-xs text-muted-foreground">Clearing in 4s...</span>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={clearCompletedUploads} data-testid="button-clear-queue">
                      Clear now
                    </Button>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {uploadQueue.map((item) => (
                      <Card key={item.id} className="p-3" data-testid={`upload-item-${item.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="shrink-0">
                            {item.status === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                            {item.status === "complete" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                            {item.status === "error" && <XCircle className="w-4 h-4 text-destructive" />}
                            {item.status === "pending" && <Clock className="w-4 h-4 text-muted-foreground" />}
                            {item.status === "skipped" && <SkipForward className="w-4 h-4 text-muted-foreground" />}
                            {item.status === "processing" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{item.fileName}</p>
                              <span className="text-xs text-muted-foreground shrink-0">{formatBytes(item.fileSize)}</span>
                            </div>
                            {item.status === "uploading" && (
                              <Progress value={item.progress} className="h-1.5 mt-1.5" />
                            )}
                            {item.error && (
                              <p className="text-xs text-destructive mt-1">{item.error}</p>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Selection Bar */}
              {filteredVideos.length > 0 && (
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={filteredVideos.length > 0 && filteredVideos.every(v => selectedVideos.has(v.guid))}
                      onCheckedChange={() => selectAllFilteredVideos(filteredVideos)}
                      data-testid="checkbox-select-all"
                    />
                    <span className="text-xs text-muted-foreground">
                      {selectedVideos.size > 0 ? `${selectedVideos.size} selected` : "Select all"}
                    </span>
                  </div>

                  {selectedVideos.size > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" data-testid="button-bulk-move">
                            <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
                            Move to
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Move {selectedVideos.size} video{selectedVideos.size > 1 ? "s" : ""} to collection</DialogTitle>
                          </DialogHeader>
                          <Select value={moveTargetCollection} onValueChange={setMoveTargetCollection}>
                            <SelectTrigger data-testid="select-move-target">
                              <SelectValue placeholder="Choose a collection" />
                            </SelectTrigger>
                            <SelectContent>
                              {collections
                                .filter(c => c.guid !== selectedCollection)
                                .map(c => (
                                  <SelectItem key={c.guid} value={c.guid}>{c.name}</SelectItem>
                                ))
                              }
                            </SelectContent>
                          </Select>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button
                              onClick={() => handleBulkMove(moveTargetCollection)}
                              disabled={!moveTargetCollection || moveVideoMutation.isPending}
                              data-testid="button-confirm-move"
                            >
                              {moveVideoMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-1.5" />}
                              Move
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {selectedCollection && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" data-testid="button-bulk-remove-collection">
                              <FolderMinus className="w-3.5 h-3.5 mr-1.5" />
                              Remove from collection
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {selectedVideos.size} video{selectedVideos.size > 1 ? "s" : ""} from collection?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The videos will be removed from this collection but not deleted. They will still appear under "All Videos".
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleRemoveFromCollection} data-testid="button-confirm-remove-collection">
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" data-testid="button-bulk-delete">
                            <Trash2 className="w-3.5 h-3.5 mr-1.5 text-destructive" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {selectedVideos.size} video{selectedVideos.size > 1 ? "s" : ""}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the selected videos. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground" data-testid="button-confirm-bulk-delete">
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <Button size="sm" variant="ghost" onClick={() => setSelectedVideos(new Set())} data-testid="button-clear-selection">
                        <XCircle className="w-3.5 h-3.5 mr-1.5" />
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Videos Grid/List */}
              {videosQuery.isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Loading videos...</p>
                  </div>
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <FileVideo className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                    <h3 className="text-base font-medium text-foreground mb-1">
                      {searchQuery ? "No videos found" : "No videos yet"}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {searchQuery ? "Try a different search term" : "Upload videos or select a watch folder to get started"}
                    </p>
                    {!searchQuery && (
                      <Button onClick={() => fileInputRef.current?.click()} data-testid="button-empty-upload">
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Videos
                      </Button>
                    )}
                  </div>
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {filteredVideos.map((video) => (
                    <VideoCard key={video.guid} video={video} onDelete={() => deleteVideoMutation.mutate(video.guid)} downloadDomain={downloadDomain} selected={selectedVideos.has(video.guid)} onToggleSelect={() => toggleVideoSelection(video.guid)} onPlay={() => setPlayingVideo(video)} />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredVideos.map((video) => (
                    <VideoListItem key={video.guid} video={video} onDelete={() => deleteVideoMutation.mutate(video.guid)} downloadDomain={downloadDomain} selected={selectedVideos.has(video.guid)} onToggleSelect={() => toggleVideoSelection(video.guid)} onPlay={() => setPlayingVideo(video)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Get Info Dialog */}
        <Dialog open={infoDialogOpen} onOpenChange={setInfoDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-get-info">
            <DialogHeader>
              <DialogTitle>{selectedCollectionData ? selectedCollectionData.name : "All Videos"} — Video Info</DialogTitle>
            </DialogHeader>
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">#</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Video Name</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">File ID</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVideos.map((video, idx) => (
                    <tr key={video.guid} className="border-b last:border-0" data-testid={`row-info-${video.guid}`}>
                      <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2 px-3 truncate max-w-[300px]" title={video.title}>{video.title}</td>
                      <td className="py-2 px-3 font-mono text-xs">{video.guid}</td>
                      <td className="py-2 px-3">{getStatusBadge(video.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                data-testid="button-copy-info"
                onClick={() => {
                  const text = filteredVideos
                    .map((v, i) => `${i + 1}. ${v.title} | ${v.guid} | ${getStatusText(v.status)}`)
                    .join("\n");
                  navigator.clipboard.writeText(text).then(() => {
                    toast({ title: "Video info copied to clipboard" });
                  });
                }}
              >
                <Copy className="w-4 h-4 mr-1.5" />
                Copy All
              </Button>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Video Player Dialog */}
        <Dialog open={!!playingVideo} onOpenChange={(open) => { if (!open) setPlayingVideo(null); }}>
          <DialogContent className="max-w-[50vw] p-0 overflow-hidden" data-testid="dialog-video-player">
            {playingVideo && (() => {
              const libraryId = uploadConfigQuery.data?.libraryId;
              return (
                <div>
                  <div className="aspect-video bg-black">
                    {libraryId ? (
                      <iframe
                        src={`https://iframe.mediadelivery.net/embed/${libraryId}/${playingVideo.guid}?autoplay=true`}
                        className="w-full h-full border-0"
                        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        data-testid="iframe-video-player"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <p className="text-sm">Library ID not configured. Set it in Settings.</p>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="text-base font-medium mb-1" data-testid="text-player-title">{playingVideo.title}</h3>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4 flex-wrap">
                      {getStatusBadge(playingVideo.status)}
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {playingVideo.views} views</span>
                      {playingVideo.storageSize ? <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> {formatBytes(playingVideo.storageSize)}</span> : null}
                      {playingVideo.length > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDuration(playingVideo.length)}</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(playingVideo.dateUploaded).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {libraryId && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="button-copy-iframe-link"
                          onClick={() => {
                            const link = `https://iframe.mediadelivery.net/play/${libraryId}/${playingVideo.guid}`;
                            navigator.clipboard.writeText(link).then(() => {
                              toast({ title: "Iframe link copied" });
                            });
                          }}
                        >
                          <Copy className="w-3.5 h-3.5 mr-1.5" />
                          Copy Iframe Link
                        </Button>
                      )}
                      {downloadDomain && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="button-copy-download-480p"
                            onClick={() => {
                              const link = `https://${downloadDomain}/${playingVideo.guid}/play_480p.mp4`;
                              navigator.clipboard.writeText(link).then(() => {
                                toast({ title: "480p download link copied" });
                              });
                            }}
                          >
                            <Copy className="w-3.5 h-3.5 mr-1.5" />
                            Copy 480p Link
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="button-copy-download-720p"
                            onClick={() => {
                              const link = `https://${downloadDomain}/${playingVideo.guid}/play_720p.mp4`;
                              navigator.clipboard.writeText(link).then(() => {
                                toast({ title: "720p download link copied" });
                              });
                            }}
                          >
                            <Copy className="w-3.5 h-3.5 mr-1.5" />
                            Copy 720p Link
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

function VideoCard({ video, onDelete, downloadDomain, selected, onToggleSelect, onPlay }: { video: BunnyVideo; onDelete: () => void; downloadDomain: string; selected: boolean; onToggleSelect: () => void; onPlay: () => void }) {
  const thumbnailUrl = video.thumbnailFileName
    ? `https://${downloadDomain}/${video.guid}/${video.thumbnailFileName}`
    : null;

  return (
    <Card className={`overflow-visible group ${selected ? "ring-2 ring-primary" : ""}`} data-testid={`card-video-${video.guid}`}>
      <div className="aspect-video bg-muted rounded-t-md overflow-hidden relative">
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            className="bg-background/80"
            data-testid={`checkbox-video-${video.guid}`}
          />
        </div>
        <div className="cursor-pointer w-full h-full" onClick={onPlay} data-testid={`button-play-video-${video.guid}`}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={video.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileVideo className="w-10 h-10 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
              <Play className="w-5 h-5 text-black ml-0.5" />
            </div>
          </div>
        </div>
        {video.length > 0 && (
          <span className="absolute bottom-2 right-2 bg-black/75 text-white text-xs px-1.5 py-0.5 rounded pointer-events-none">
            {formatDuration(video.length)}
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-medium truncate mb-1.5 cursor-pointer" title={video.title} onClick={onPlay} data-testid={`text-video-title-${video.guid}`}>
          {video.title}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {getStatusBadge(video.status)}
            {[2, 3, 6].includes(video.status) && video.encodeProgress !== undefined && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground" data-testid={`text-encode-progress-${video.guid}`}>
                <Percent className="w-3 h-3" /> {video.encodeProgress}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                  <Eye className="w-3 h-3" /> {video.views}
                </span>
              </TooltipTrigger>
              <TooltipContent>{video.views} views</TooltipContent>
            </Tooltip>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 h-7 w-7" data-testid={`button-delete-video-${video.guid}`}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete video?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{video.title}" and cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {[2, 3, 6].includes(video.status) && video.encodeProgress !== undefined && video.encodeProgress > 0 && video.encodeProgress < 100 && (
          <Progress value={video.encodeProgress} className="h-1 mt-2" data-testid={`progress-encode-${video.guid}`} />
        )}
        {video.storageSize ? (
          <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
            <HardDrive className="w-3 h-3" /> {formatBytes(video.storageSize)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function VideoListItem({ video, onDelete, downloadDomain, selected, onToggleSelect, onPlay }: { video: BunnyVideo; onDelete: () => void; downloadDomain: string; selected: boolean; onToggleSelect: () => void; onPlay: () => void }) {
  const thumbnailUrl = video.thumbnailFileName
    ? `https://${downloadDomain}/${video.guid}/${video.thumbnailFileName}`
    : null;

  return (
    <div className={`flex items-center gap-4 px-4 py-2.5 rounded-md hover-elevate group ${selected ? "ring-2 ring-primary" : ""}`} data-testid={`row-video-${video.guid}`}>
      <Checkbox
        checked={selected}
        onCheckedChange={onToggleSelect}
        data-testid={`checkbox-video-${video.guid}`}
      />
      <div className="w-28 h-16 rounded-md bg-muted overflow-hidden shrink-0 relative cursor-pointer" onClick={onPlay} data-testid={`button-play-video-${video.guid}`}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={video.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileVideo className="w-6 h-6 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="w-3.5 h-3.5 text-black ml-0.5" />
          </div>
        </div>
        {video.length > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/75 text-white text-[10px] px-1 py-0.5 rounded pointer-events-none">
            {formatDuration(video.length)}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium truncate" data-testid={`text-video-title-${video.guid}`}>{video.title}</h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {video.views}</span>
          {video.storageSize ? <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> {formatBytes(video.storageSize)}</span> : null}
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(video.dateUploaded).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {getStatusBadge(video.status)}
        {[2, 3, 6].includes(video.status) && video.encodeProgress !== undefined && (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5" data-testid={`text-list-encode-progress-${video.guid}`}>
            {video.encodeProgress}%
          </span>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100" data-testid={`button-delete-video-${video.guid}`}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete video?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently delete "{video.title}".</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
