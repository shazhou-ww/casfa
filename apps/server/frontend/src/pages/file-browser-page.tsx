/**
 * FileBrowserPage — file browser for a single depot.
 *
 * Integrates @cubone/react-file-manager with the CASFA filesystem API.
 * Each depot has a root node key; all fs operations are relative to that root.
 * After every mutation, the new root is committed to the depot.
 */

import { Alert, Box, CircularProgress, Snackbar, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";
import {
  commitDepot,
  fsCp,
  fsLs,
  fsMkdir,
  fsMv,
  fsRead,
  fsRm,
  fsWrite,
} from "../lib/fs-api.ts";
import { useDepotStore } from "../stores/depot-store.ts";

// @cubone/react-file-manager types
import { FileManager } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";

// ============================================================================
// Types
// ============================================================================

type FMFile = {
  name: string;
  isDirectory: boolean;
  path: string;
  updatedAt?: string;
  size?: number;
};

// ============================================================================
// Component
// ============================================================================

export function FileBrowserPage() {
  const { depotId } = useParams<{ depotId: string }>();
  const { depots, fetchDepots } = useDepotStore();
  const depot = depots.find((d) => d.depotId === depotId);

  // Mutable root ref — updated after each fs mutation & commit
  const rootKeyRef = useRef<string | null>(null);

  const [files, setFiles] = useState<FMFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOperating, setIsOperating] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });

  const showError = (msg: string) => {
    setSnackbar({ open: true, message: msg, severity: "error" });
  };
  const showSuccess = (msg: string) => {
    setSnackbar({ open: true, message: msg, severity: "success" });
  };

  // ============================================================================
  // Root management
  // ============================================================================

  /**
   * After a mutating fs operation that returns newRoot,
   * commit the new root to the depot and update local ref.
   */
  const commitNewRoot = useCallback(
    async (newRoot: string) => {
      if (!depotId) return;
      const result = await commitDepot(depotId, newRoot);
      if (result.ok) {
        rootKeyRef.current = newRoot;
      } else {
        showError(`Failed to commit: ${result.error}`);
      }
    },
    [depotId]
  );

  // ============================================================================
  // Load directory listing
  // ============================================================================

  /**
   * Load all files for the entire depot tree (flat list).
   * @cubone/react-file-manager expects ALL files/folders in a flat array with paths.
   * We recursively list from root.
   */
  const loadFiles = useCallback(
    async (rootKey: string) => {
      setLoading(true);
      setError(null);

      try {
        const allFiles: FMFile[] = [];
        const dirsToVisit: string[] = [""];

        while (dirsToVisit.length > 0) {
          const dir = dirsToVisit.pop()!;
          let cursor: string | undefined;

          do {
            const result = await fsLs(rootKey, dir, 500, cursor);
            if (!result.ok) {
              setError(result.error);
              setLoading(false);
              return;
            }

            for (const child of result.data.children) {
              const childPath = dir ? `${dir}/${child.name}` : child.name;
              allFiles.push({
                name: child.name,
                isDirectory: child.type === "dir",
                path: `/${childPath}`,
                size: child.size,
              });

              if (child.type === "dir") {
                dirsToVisit.push(childPath);
              }
            }

            cursor = result.data.nextCursor ?? undefined;
          } while (cursor);
        }

        setFiles(allFiles);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ============================================================================
  // Initial load
  // ============================================================================

  useEffect(() => {
    if (!depot) return;

    const rootKey = depot.root;
    if (!rootKey) {
      // Empty depot — no root yet
      rootKeyRef.current = null;
      setFiles([]);
      setLoading(false);
      return;
    }

    rootKeyRef.current = rootKey;
    loadFiles(rootKey);
  }, [depot, loadFiles]);

  // ============================================================================
  // File Manager Callbacks
  // ============================================================================

  const handleCreateFolder = useCallback(
    async (name: string, parentFolder: FMFile) => {
      if (!rootKeyRef.current) {
        // Depot has no root yet — need to get the empty dict key
        // Fetch depot detail to get or create root
        try {
          const client = await getClient();
          const depotDetail = await client.depots.get(depotId!);
          if (!depotDetail.ok) {
            showError("Cannot access depot");
            return;
          }
          if (!depotDetail.data.root) {
            showError("Depot has no root. Upload a file first.");
            return;
          }
          rootKeyRef.current = depotDetail.data.root;
        } catch {
          showError("Failed to get depot info");
          return;
        }
      }

      setIsOperating(true);
      const fullPath =
        parentFolder.path === "/" || parentFolder.path === ""
          ? name
          : `${parentFolder.path.replace(/^\//, "")}/${name}`;

      const result = await fsMkdir(rootKeyRef.current!, fullPath);
      if (result.ok) {
        await commitNewRoot(result.data.newRoot);
        // Add folder to local state
        setFiles((prev) => [
          ...prev,
          { name, isDirectory: true, path: `/${fullPath}` },
        ]);
        showSuccess(`Folder "${name}" created`);
      } else {
        showError(`mkdir failed: ${result.error}`);
      }
      setIsOperating(false);
    },
    [depotId, commitNewRoot]
  );

  const handleDelete = useCallback(
    async (filesToDelete: FMFile[]) => {
      if (!rootKeyRef.current) return;

      setIsOperating(true);
      let currentRoot = rootKeyRef.current;

      for (const file of filesToDelete) {
        const path = file.path.replace(/^\//, "");
        const result = await fsRm(currentRoot, path);
        if (result.ok) {
          currentRoot = result.data.newRoot;
        } else {
          showError(`Delete failed for "${file.name}": ${result.error}`);
          setIsOperating(false);
          return;
        }
      }

      await commitNewRoot(currentRoot);

      // Remove from local state
      const deletedPaths = new Set(filesToDelete.map((f) => f.path));
      setFiles((prev) =>
        prev.filter(
          (f) =>
            !deletedPaths.has(f.path) &&
            !Array.from(deletedPaths).some(
              (dp) => f.path.startsWith(dp + "/")
            )
        )
      );
      showSuccess(
        `Deleted ${filesToDelete.length} item${filesToDelete.length > 1 ? "s" : ""}`
      );
      setIsOperating(false);
    },
    [commitNewRoot]
  );

  const handleRename = useCallback(
    async (file: FMFile, newName: string) => {
      if (!rootKeyRef.current) return;

      setIsOperating(true);
      const oldPath = file.path.replace(/^\//, "");
      const parentDir = oldPath.includes("/")
        ? oldPath.substring(0, oldPath.lastIndexOf("/"))
        : "";
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;

      const result = await fsMv(rootKeyRef.current, oldPath, newPath);
      if (result.ok) {
        await commitNewRoot(result.data.newRoot);
        // Update local state
        const oldPrefix = file.path;
        setFiles((prev) =>
          prev.map((f) => {
            if (f.path === oldPrefix) {
              return { ...f, name: newName, path: `/${newPath}` };
            }
            if (f.path.startsWith(oldPrefix + "/")) {
              return {
                ...f,
                path: f.path.replace(oldPrefix, `/${newPath}`),
              };
            }
            return f;
          })
        );
        showSuccess(`Renamed to "${newName}"`);
      } else {
        showError(`Rename failed: ${result.error}`);
      }
      setIsOperating(false);
    },
    [commitNewRoot]
  );

  const handlePaste = useCallback(
    async (
      filesToPaste: FMFile[],
      destinationFolder: FMFile,
      operationType: "copy" | "move"
    ) => {
      if (!rootKeyRef.current) return;

      setIsOperating(true);
      let currentRoot = rootKeyRef.current;
      const newFiles: FMFile[] = [];

      for (const file of filesToPaste) {
        const fromPath = file.path.replace(/^\//, "");
        const destDir =
          destinationFolder.path === "/" || destinationFolder.path === ""
            ? ""
            : destinationFolder.path.replace(/^\//, "");
        const toPath = destDir ? `${destDir}/${file.name}` : file.name;

        const fn = operationType === "copy" ? fsCp : fsMv;
        const result = await fn(currentRoot, fromPath, toPath);

        if (result.ok) {
          currentRoot = result.data.newRoot;
          newFiles.push({
            ...file,
            path: `/${toPath}`,
          });
        } else {
          showError(
            `${operationType === "copy" ? "Copy" : "Move"} failed for "${file.name}": ${result.error}`
          );
          setIsOperating(false);
          return;
        }
      }

      await commitNewRoot(currentRoot);

      // Reload files to get accurate state after bulk operations
      await loadFiles(currentRoot);
      showSuccess(
        `${operationType === "copy" ? "Copied" : "Moved"} ${filesToPaste.length} item${filesToPaste.length > 1 ? "s" : ""}`
      );
      setIsOperating(false);
    },
    [commitNewRoot, loadFiles]
  );

  const handleDownload = useCallback(
    async (filesToDownload: FMFile[]) => {
      if (!rootKeyRef.current) return;

      for (const file of filesToDownload) {
        if (file.isDirectory) continue; // Can't download directories

        const path = file.path.replace(/^\//, "");
        const result = await fsRead(rootKeyRef.current, path);
        if (result.ok) {
          // Trigger browser download
          const url = URL.createObjectURL(result.data);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          showError(`Download failed for "${file.name}": ${result.error}`);
        }
      }
    },
    []
  );

  const handleRefresh = useCallback(async () => {
    if (!depotId) return;

    // Re-fetch depot to get latest root
    await fetchDepots();
    const updatedDepot = useDepotStore
      .getState()
      .depots.find((d) => d.depotId === depotId);

    if (updatedDepot?.root) {
      rootKeyRef.current = updatedDepot.root;
      await loadFiles(updatedDepot.root);
    }
  }, [depotId, fetchDepots, loadFiles]);

  /**
   * Handle file upload.
   * We intercept the upload process and use our fsWrite API instead of
   * the built-in HTTP upload (since we need to use Access Token auth
   * and our custom endpoint format).
   *
   * We disable the built-in upload by not providing fileUploadConfig,
   * and instead use a hidden file input.
   */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetPathRef = useRef<string>("");

  const handleFileUploadClick = useCallback(() => {
    // Store current path for the upload target
    uploadTargetPathRef.current = currentPath;
    fileInputRef.current?.click();
  }, [currentPath]);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      if (!rootKeyRef.current) {
        showError("Depot has no root. Please try again.");
        return;
      }

      setIsOperating(true);
      let currentRoot = rootKeyRef.current;
      const newFiles: FMFile[] = [];

      for (const file of Array.from(fileList)) {
        if (file.size > 4 * 1024 * 1024) {
          showError(`"${file.name}" exceeds 4 MB limit`);
          continue;
        }

        const targetDir = uploadTargetPathRef.current.replace(/^\//, "");
        const filePath = targetDir ? `${targetDir}/${file.name}` : file.name;
        const content = new Uint8Array(await file.arrayBuffer());

        const result = await fsWrite(
          currentRoot,
          filePath,
          content,
          file.type || "application/octet-stream"
        );

        if (result.ok) {
          currentRoot = result.data.newRoot;
          newFiles.push({
            name: file.name,
            isDirectory: false,
            path: `/${filePath}`,
            size: file.size,
          });
        } else {
          showError(`Upload failed for "${file.name}": ${result.error}`);
        }
      }

      if (newFiles.length > 0) {
        await commitNewRoot(currentRoot);
        // Add to local state
        setFiles((prev) => {
          const existing = new Set(prev.map((f) => f.path));
          const additions = newFiles.filter((f) => !existing.has(f.path));
          return [...prev, ...additions];
        });
        showSuccess(`Uploaded ${newFiles.length} file${newFiles.length > 1 ? "s" : ""}`);
      }

      // Reset input
      e.target.value = "";
      setIsOperating(false);
    },
    [commitNewRoot]
  );

  // ============================================================================
  // Render
  // ============================================================================

  if (!depot) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <Typography color="text.secondary">Depot not found</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Depot title */}
      <Box mb={2}>
        <Typography variant="h5" fontWeight={600}>
          {depot.title || depot.depotId}
        </Typography>
        {!depot.root && (
          <Alert severity="info" sx={{ mt: 1 }}>
            This depot is empty. Upload files to get started.
          </Alert>
        )}
      </Box>

      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      {/* File Manager */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <FileManager
          files={files}
          isLoading={isOperating}
          height="100%"
          width="100%"
          layout="list"
          primaryColor="#1976d2"
          fontFamily="Roboto, sans-serif"
          enableFilePreview={false}
          initialPath={currentPath}
          onFolderChange={setCurrentPath}
          onCreateFolder={handleCreateFolder}
          onDelete={handleDelete}
          onRename={handleRename}
          onPaste={handlePaste}
          onDownload={handleDownload}
          onRefresh={handleRefresh}
          onFileOpen={(file: FMFile) => {
            if (!file.isDirectory) {
              // Download on double-click
              handleDownload([file]);
            }
          }}
          permissions={{
            create: true,
            upload: true,
            download: true,
            delete: true,
            rename: true,
            copy: true,
            move: true,
          }}
          // Custom upload handling — we override with our own button
          // since we need to use the CASFA fs API, not a simple HTTP POST
          fileUploadConfig={undefined as unknown as { url: string }}
          onFileUploading={() => {
            // Intercept: trigger our own upload flow
            handleFileUploadClick();
            return {};
          }}
          maxFileSize={4 * 1024 * 1024}
          onError={(err: { type: string; message: string }) => {
            showError(err.message);
          }}
          language="en-US"
        />
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
