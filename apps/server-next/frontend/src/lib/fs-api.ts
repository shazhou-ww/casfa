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
