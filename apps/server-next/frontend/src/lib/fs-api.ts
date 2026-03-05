import type { FsEntry } from "../types/api";
import { apiFetch, authClient } from "./auth";

function normalizedPathSegments(path: string): string {
  const p = !path || path === "/" ? "" : path.replace(/^\/+/, "").replace(/\/+$/, "");
  return p;
}

function filesBaseUrl(): string {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) throw new Error("Not authenticated: realmId (user) not loaded");
  return `/api/realm/${realmId}/files`;
}

export type FileStat = {
  kind: "file" | "directory";
  size?: number;
  contentType?: string;
};

/**
 * Get file/directory metadata (kind, size, contentType for files).
 * Uses GET with query meta=1.
 */
export async function fetchFileStat(path: string): Promise<FileStat> {
  const base = filesBaseUrl();
  const segs = normalizedPathSegments(path);
  const url = segs ? `${base}/${segs}` : base;
  const res = await apiFetch(`${url}?meta=1`);
  if (!res.ok) {
    let message = "Failed to stat";
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // response may not be JSON
    }
    throw new Error(message);
  }
  const data = (await res.json()) as {
    kind: "file" | "directory";
    size?: number;
    contentType?: string;
  };
  return {
    kind: data.kind,
    ...(data.size !== undefined && { size: data.size }),
    ...(data.contentType !== undefined && { contentType: data.contentType }),
  };
}

/**
 * Fetch file content as Blob. Path is full path e.g. "/folder/file.png".
 * Fails if the path is a directory.
 */
export async function fetchFileBlob(path: string): Promise<Blob> {
  const base = filesBaseUrl();
  const segs = normalizedPathSegments(path);
  if (!segs) throw new Error("Path must point to a file");
  const url = `${base}/${segs}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    let message = "Failed to fetch file";
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // response may not be JSON
    }
    throw new Error(message);
  }
  return res.blob();
}

/**
 * Create a blob URL for a file. Call revokeFileBlobUrl when done to avoid leaks.
 */
export function createFileBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Revoke a blob URL created with createFileBlobUrl.
 */
export function revokeFileBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}

/** MIME types we treat as image for preview */
const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
]);

export function isImageContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return IMAGE_CONTENT_TYPES.has(base);
}

export async function fetchList(path: string): Promise<FsEntry[]> {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }

  const normalizedPath = !path || path === "/" ? "" : path.replace(/^\/+/, "").replace(/\/+$/, "");
  const url = normalizedPath
    ? `/api/realm/${realmId}/files/${normalizedPath}`
    : `/api/realm/${realmId}/files`;

  const res = await apiFetch(url);
  if (!res.ok) throw new Error("Failed to list directory");
  const data = (await res.json()) as {
    entries?: Array<{ name: string; kind: string; size?: number }>;
  };
  const entries = data.entries ?? [];

  const basePath = normalizedPath ? `/${normalizedPath}` : "";
  return entries.map((entry) => ({
    name: entry.name,
    path: basePath ? `${basePath}/${entry.name}` : `/${entry.name}`,
    isDirectory: entry.kind === "directory",
    size: entry.size,
  }));
}

/**
 * Create a directory. path is relative to realm root (no leading slash).
 * For "current dir + name": pass normalized current path + name, e.g. "" and "MyFolder" or "foo/bar" and "MyFolder".
 */
export async function createFolder(parentPath: string, name: string): Promise<void> {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }
  const normalizedParent =
    !parentPath || parentPath === "/" ? "" : parentPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const pathStr = normalizedParent ? `${normalizedParent}/${name.trim()}` : name.trim();
  if (!pathStr) {
    throw new Error("Folder name is required");
  }

  const res = await apiFetch(`/api/realm/${realmId}/fs/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: pathStr }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string; message?: string };
    throw new Error(data.message ?? data.error ?? "Failed to create folder");
  }
}

function normalizePath(path: string): string {
  return !path || path === "/" ? "" : path.replace(/^\/+/, "").replace(/\/+$/, "");
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Upload a file to the given path (path must include file name).
 * Uses PUT /api/realm/:realmId/files/:path. Max 4MB per file.
 */
export async function uploadFile(path: string, file: File): Promise<void> {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) throw new Error("Not authenticated");
  const normalized = normalizePath(path);
  if (!normalized) throw new Error("Path must include file name");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`);
  }
  const url = `/api/realm/${realmId}/files/${normalized}`;
  const res = await apiFetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Upload failed");
  }
}

/**
 * Delete a file or directory at the given path.
 */
export async function deletePath(path: string): Promise<void> {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }
  const normalized = normalizePath(path);
  if (normalized === "") {
    throw new Error("Path required");
  }
  const res = await apiFetch(`/api/realm/${realmId}/fs/rm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: normalized }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Delete failed");
  }
}

/**
 * Move a file or directory from one path to another.
 */
export async function movePath(from: string, to: string): Promise<void> {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }
  const fromNorm = normalizePath(from);
  const toNorm = normalizePath(to);
  if (fromNorm === "" || toNorm === "") {
    throw new Error("from and to required");
  }
  const res = await apiFetch(`/api/realm/${realmId}/fs/mv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromNorm, to: toNorm }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Move failed");
  }
}

/**
 * Copy a file or directory from one path to another.
 */
export async function copyPath(from: string, to: string): Promise<void> {
  const realmId = authClient.getAuth()?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }
  const fromNorm = normalizePath(from);
  const toNorm = normalizePath(to);
  if (fromNorm === "" || toNorm === "") {
    throw new Error("from and to required");
  }
  const res = await apiFetch(`/api/realm/${realmId}/fs/cp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromNorm, to: toNorm }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { message?: string };
    throw new Error(data.message ?? "Copy failed");
  }
}
