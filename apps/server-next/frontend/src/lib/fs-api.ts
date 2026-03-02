import type { FsEntry } from "../types/api";
import { useAuthStore } from "../stores/auth-store";
import { apiFetch } from "./auth";

const MOCK_ENTRIES_ROOT: FsEntry[] = [
  { name: "Documents", path: "/Documents", isDirectory: true },
  { name: "Projects", path: "/Projects", isDirectory: true },
  { name: "readme.txt", path: "/readme.txt", isDirectory: false, size: 1024 },
];

export async function fetchList(path: string, useMock: boolean): Promise<FsEntry[]> {
  if (useMock) {
    if (!path || path === "/") return MOCK_ENTRIES_ROOT;
    return [
      { name: "subfolder", path: `${path}/subfolder`, isDirectory: true },
      { name: "file.txt", path: `${path}/file.txt`, isDirectory: false, size: 512 },
    ];
  }

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
