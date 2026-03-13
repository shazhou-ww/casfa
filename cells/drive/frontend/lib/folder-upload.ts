export type UploadEntry = { relativePath: string; file: File };

/** DataTransferItem with WebKit folder API (not in standard TypeScript DOM lib). */
interface DataTransferItemWithEntry extends DataTransferItem {
  webkitGetAsEntry?: () => FileSystemEntry | null;
}

function readDirEntries(entry: FileSystemDirectoryEntry, prefix: string): Promise<UploadEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();
    const acc: UploadEntry[] = [];
    function readBatch(): void {
      reader.readEntries(
        async (entries: FileSystemEntry[]) => {
          if (entries.length === 0) {
            resolve(acc);
            return;
          }
          for (const child of entries) {
            if (child.isDirectory) {
              const sub = await readDirEntries(child as FileSystemDirectoryEntry, prefix + child.name + "/");
              acc.push(...sub);
            } else {
              const file = await new Promise<File>((res, rej) =>
                (child as FileSystemFileEntry).file(res, rej)
              );
              acc.push({ relativePath: prefix + child.name, file });
            }
          }
          readBatch();
        },
        reject
      );
    }
    readBatch();
  });
}

/**
 * Result when drop uses folder API: file entries and top-level directory names (for empty folders).
 */
export type DropResult = { entries: UploadEntry[]; topLevelDirNames: string[] };

/**
 * Collects files from a drag-drop DataTransfer using the folder API (webkitGetAsEntry).
 * Returns null if there are no items or the browser does not support webkitGetAsEntry
 * (caller should fall back to dataTransfer.files).
 * When drop contains directories, topLevelDirNames is filled so empty folders can be created.
 */
export async function collectFromDrop(
  dataTransfer: DataTransfer | null | undefined
): Promise<DropResult | null> {
  if (!dataTransfer?.items?.length) return null;
  const firstItem = dataTransfer.items[0];
  const getEntry = (firstItem as DataTransferItemWithEntry).webkitGetAsEntry;
  if (typeof getEntry !== "function") return null;

  const entries: UploadEntry[] = [];
  const topLevelDirNames: string[] = [];
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i]!;
    const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null;
    if (!entry) continue;
    if (entry.isDirectory) {
      topLevelDirNames.push(entry.name);
      const dirEntries = await readDirEntries(entry as FileSystemDirectoryEntry, entry.name + "/");
      entries.push(...dirEntries);
    } else {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej)
      );
      entries.push({ relativePath: entry.name, file });
    }
  }
  return { entries, topLevelDirNames };
}

export function collectFromFileList(files: FileList | File[]): UploadEntry[] {
  const arr = Array.isArray(files) ? files : Array.from(files);
  return arr.map((file) => {
    const webkitRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const relativePath = (webkitRelativePath && webkitRelativePath.trim() !== "")
      ? webkitRelativePath
      : file.name;
    return { relativePath, file };
  });
}

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

export type UploadDeps = {
  createFolder: (parentPath: string, name: string) => Promise<void>;
  uploadFile: (path: string, file: File) => Promise<void>;
};

export type UploadResult = {
  success: number;
  failed: number;
  errors: string[];
  cancelled?: boolean;
};

export async function runUploadWithProgress(
  entries: UploadEntry[],
  basePath: string,
  deps: UploadDeps,
  callbacks: { onProgress: (done: number, total: number) => void; getCancelled?: () => boolean }
): Promise<UploadResult> {
  const normalizedBase = basePath.replace(/^\/+|\/+$/g, "") || "";
  const total = entries.length;
  const errors: string[] = [];
  let done = 0;
  let success = 0;

  const mkdirPaths = getMkdirPaths(entries);
  for (const rel of mkdirPaths) {
    if (callbacks.getCancelled?.()) return { success, failed: errors.length, errors, cancelled: true };
    const parent = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
    const name = rel.includes("/") ? rel.split("/").pop()! : rel;
    const parentFull = normalizedBase ? `${normalizedBase}/${parent}` : parent;
    await deps.createFolder(parentFull || "/", name);
  }

  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const CONCURRENCY = 2;
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < sorted.length && !callbacks.getCancelled?.()) {
      const i = index++;
      const { relativePath, file } = sorted[i]!;
      const fullPath = normalizedBase ? `${normalizedBase}/${relativePath}` : relativePath;
      try {
        await deps.uploadFile(fullPath, file);
        success++;
      } catch (e) {
        errors.push(`${relativePath}: ${e instanceof Error ? e.message : "上传失败"}`);
      }
      done++;
      callbacks.onProgress(done, total);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, runNext));
  return { success, failed: errors.length, errors };
}
