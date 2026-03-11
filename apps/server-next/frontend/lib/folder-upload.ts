export type UploadEntry = { relativePath: string; file: File };

export const DEFAULT_LIMITS = {
  maxFiles: 500,
  maxDepth: 10,
  maxFileBytes: 4 * 1024 * 1024,
};

export function validateUploadPlan(
  entries: UploadEntry[],
  limits: { maxFiles?: number; maxDepth?: number; maxFileBytes?: number } = {}
): { ok: true } | { ok: false; message: string } {
  const { maxFiles, maxDepth, maxFileBytes } = { ...DEFAULT_LIMITS, ...limits };
  if (entries.length > maxFiles) return { ok: false, message: `超过 ${maxFiles} 个文件` };
  for (const { relativePath, file } of entries) {
    const depth = relativePath.split("/").filter(Boolean).length;
    if (depth > maxDepth) return { ok: false, message: "路径过深" };
    if (file.size > maxFileBytes) return { ok: false, message: `${file.name} 超过 4MB` };
  }
  return { ok: true };
}

export function getMkdirPaths(entries: UploadEntry[]): string[] {
  const dirs = new Set<string>();
  for (const { relativePath } of entries) {
    const parts = relativePath.split("/").filter(Boolean);
    parts.pop(); // file name
    for (let i = 0; i < parts.length; i++) dirs.add(parts.slice(0, i + 1).join("/"));
  }
  return Array.from(dirs).sort();
}
