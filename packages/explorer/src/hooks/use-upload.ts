/**
 * Upload logic hook — manages the upload queue lifecycle.
 *
 * Validates file sizes, enqueues files, and processes them sequentially.
 */

import { useCallback, useEffect, useRef } from "react";
import { useExplorerStore } from "./use-explorer-context.ts";
import type { ExplorerError } from "../types.ts";

/** Maximum single file size: 4 MB */
const MAX_FILE_SIZE = 4 * 1024 * 1024;

type UseUploadOpts = {
  onError?: (error: ExplorerError) => void;
};

export function useUpload({ onError }: UseUploadOpts = {}) {
  const client = useExplorerStore((s) => s.client);
  const depotId = useExplorerStore((s) => s.depotId);
  const depotRoot = useExplorerStore((s) => s.depotRoot);
  const addToUploadQueue = useExplorerStore((s) => s.addToUploadQueue);
  const updateUploadItem = useExplorerStore((s) => s.updateUploadItem);
  const removeFromUploadQueue = useExplorerStore((s) => s.removeFromUploadQueue);
  const uploadQueue = useExplorerStore((s) => s.uploadQueue);
  const setError = useExplorerStore((s) => s.setError);
  const refresh = useExplorerStore((s) => s.refresh);
  const permissions = useExplorerStore((s) => s.permissions);
  const updateDepotRoot = useExplorerStore((s) => s.updateDepotRoot);

  const isProcessingRef = useRef(false);

  /**
   * Validate and enqueue files for upload.
   * Files exceeding MAX_FILE_SIZE are skipped with an error.
   */
  const uploadFiles = useCallback(
    (files: File[]) => {
      if (!permissions.canUpload) {
        const err: ExplorerError = { type: "permission_denied", message: "Upload not permitted" };
        setError(err);
        onError?.(err);
        return;
      }

      const validFiles: File[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          const err: ExplorerError = {
            type: "file_too_large",
            message: `"${file.name}" is too large (max 4 MB)`,
          };
          setError(err);
          onError?.(err);
        } else {
          validFiles.push(file);
        }
      }
      if (validFiles.length > 0) {
        addToUploadQueue(validFiles);
      }
    },
    [addToUploadQueue, setError, onError, permissions.canUpload],
  );

  /**
   * Process the upload queue: pick the first "pending" item and upload it.
   */
  useEffect(() => {
    if (isProcessingRef.current) return;

    const nextPending = uploadQueue.find((item) => item.status === "pending");
    if (!nextPending || !depotRoot) return;

    isProcessingRef.current = true;
    updateUploadItem(nextPending.id, { status: "uploading" });

    const doUpload = async () => {
      try {
        const result = await client.fs.write(
          depotRoot,
          nextPending.targetPath,
          nextPending.file,
        );
        if (result.ok) {
          // Commit new root to depot (persists across refresh)
          if (depotId) {
            await client.depots.commit(depotId, { root: result.data.newRoot }).catch(() => {});
          }
          updateDepotRoot(result.data.newRoot);
          updateUploadItem(nextPending.id, { status: "done" });
        } else {
          updateUploadItem(nextPending.id, {
            status: "error",
            error: result.error.message,
          });
          const explorerErr: ExplorerError = {
            type: result.error.status === 403 ? "permission_denied" : "unknown",
            message: result.error.message,
          };
          onError?.(explorerErr);
        }
      } catch (e) {
        updateUploadItem(nextPending.id, {
          status: "error",
          error: e instanceof Error ? e.message : "Upload failed",
        });
      } finally {
        isProcessingRef.current = false;
      }
    };

    doUpload();
  }, [uploadQueue, depotRoot, depotId, client, updateUploadItem, updateDepotRoot, onError]);

  // Refresh directory listing when all uploads finish
  const prevHadPending = useRef(false);
  useEffect(() => {
    const hasPending = uploadQueue.some((item) => item.status === "pending" || item.status === "uploading");
    if (prevHadPending.current && !hasPending && uploadQueue.length > 0) {
      refresh();
    }
    prevHadPending.current = hasPending;
  }, [uploadQueue, refresh]);

  /** Cancel a pending upload (remove from queue) */
  const cancelUpload = useCallback(
    (id: string) => {
      removeFromUploadQueue(id);
    },
    [removeFromUploadQueue],
  );

  /** Retry a failed upload by resetting status to "pending" */
  const retryUpload = useCallback(
    (id: string) => {
      updateUploadItem(id, { status: "pending", error: undefined });
    },
    [updateUploadItem],
  );

  return { uploadFiles, cancelUpload, retryUpload };
}
