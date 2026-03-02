import type { FsEntry } from "../types/api";

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
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/entries${q}`);
  if (!res.ok) throw new Error("Failed to list directory");
  const data = await res.json();
  return data.entries ?? [];
}
