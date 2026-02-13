/**
 * Upload logic hook — manages the upload queue lifecycle.
 *
 * Validates permissions, enqueues files, and processes them sequentially.
 * File size limits are enforced by the @casfa/fs layer (FsContext.maxFileSize)
 * rather than a client-side hard cap.
 */

import { isFsError } from "@casfa/fs";
import { useCallback, useEffect, useRef } from "react";
import type { ExplorerError } from "../types.ts";
import { useExplorerStore } from "./use-explorer-context.ts";

type UseUploadOpts = {
  onError?: (error: ExplorerError) => void;
};

export function useUpload({ onError }: UseUploadOpts = {}) {
  const client = useExplorerStore((s) => s.client);
  const localFs = useExplorerStore((s) => s.localFs);
  const beforeCommit = useExplorerStore((s) => s.beforeCommit);
  const scheduleCommit = useExplorerStore((s) => s.scheduleCommit);
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
   * Validate permissions and enqueue files for upload.
   * File size limits are enforced by the fs layer during write.
   */
  const uploadFiles = useCallback(
    (files: File[]) => {
      if (!permissions.canUpload) {
        const err: ExplorerError = { type: "permission_denied", message: "Upload not permitted" };
        setError(err);
        onError?.(err);
        return;
      }

      if (files.length > 0) {
        addToUploadQueue(files);
      }
    },
    [addToUploadQueue, setError, onError, permissions.canUpload]
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
        // Convert File to Uint8Array for local FS write
        const buffer = await nextPending.file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const contentType = nextPending.file.type || "application/octet-stream";

        const result = await localFs.write(
          depotRoot,
          nextPending.targetPath,
          undefined,
          bytes,
          contentType
        );
        if (!isFsError(result)) {
          // Enqueue background commit or commit directly
          if (depotId) {
            if (scheduleCommit) {
              scheduleCommit(depotId, result.newRoot, depotRoot);
            } else {
              await beforeCommit?.();
              await client.depots.commit(depotId, { root: result.newRoot }).catch(() => {});
            }
          }
          updateDepotRoot(result.newRoot);
          updateUploadItem(nextPending.id, { status: "done" });
        } else {
          updateUploadItem(nextPending.id, {
            status: "error",
            error: result.message,
          });
          const explorerErr: ExplorerError = {
            type:
              result.code === "FILE_TOO_LARGE"
                ? "file_too_large"
                : result.status === 403
                  ? "permission_denied"
                  : "unknown",
            message: result.message,
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
  }, [
    uploadQueue,
    depotRoot,
    depotId,
    client,
    localFs,
    beforeCommit,
    scheduleCommit,
    updateUploadItem,
    updateDepotRoot,
    onError,
  ]);

  // Refresh directory listing when all uploads finish
  const prevHadPending = useRef(false);
  useEffect(() => {
    const hasPending = uploadQueue.some(
      (item) => item.status === "pending" || item.status === "uploading"
    );
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
    [removeFromUploadQueue]
  );

  /** Retry a failed upload by resetting status to "pending" */
  const retryUpload = useCallback(
    (id: string) => {
      updateUploadItem(id, { status: "pending", error: undefined });
    },
    [updateUploadItem]
  );

  return { uploadFiles, cancelUpload, retryUpload };
}
