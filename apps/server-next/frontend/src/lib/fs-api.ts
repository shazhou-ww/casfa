import type { FsEntry } from "../types/api";
import { useAuthStore } from "../stores/auth-store";
import { apiFetch } from "./auth";

export async function fetchList(path: string): Promise<FsEntry[]> {
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }

  const normalizedPath = !path || path === "/" ? "" : path.replace(/^\/+/, "").replace(/\/+$/, "");
  const url = normalizedPath
    ? `/api/realm/${realmId}/files/${normalizedPath}`
    : `/api/realm/${realmId}/files`;

  const res = await apiFetch(url);
  if (!res.ok) throw new Error("Failed to list directory");
  const data = (await res.json()) as { entries?: Array<{ name: string; kind: string; size?: number }> };
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
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) {
    throw new Error("Not authenticated: realmId (user) not loaded");
  }
  const normalizedParent = !parentPath || parentPath === "/"
    ? ""
    : parentPath.replace(/^\/+/, "").replace(/\/+$/, "");
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
