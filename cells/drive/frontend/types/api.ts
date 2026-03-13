/**
 * Minimal types for fs list API. Align with backend when available.
 */
export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
};

export type ListDirResponse = {
  entries: FsEntry[];
};
