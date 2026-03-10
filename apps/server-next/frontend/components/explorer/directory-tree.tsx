import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyPath,
  createFileBlobUrl,
  createFolder,
  deletePath,
  fetchFileBlob,
  fetchFileStat,
  fetchList,
  isImageContentType,
  movePath,
  revokeFileBlobUrl,
  uploadFile,
} from "../../lib/fs-api";
import type { FsEntry } from "../../types/api";

type DirectoryTreeProps = {
  currentPath: string;
  onPathChange: (path: string) => void;
};

function formatPath(path: string): string[] {
  if (!path || path === "/") return [];
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

async function fetchListForTree(path: string): Promise<FsEntry[]> {
  return fetchList(path);
}

export function DirectoryTree({ currentPath, onPathChange }: DirectoryTreeProps) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [fileActionLoading, setFileActionLoading] = useState(false);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [contextMenuAnchor, setContextMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuEntry, setContextMenuEntry] = useState<FsEntry | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<FsEntry | null>(null);
  const [moveCopyDialog, setMoveCopyDialog] = useState<{
    open: boolean;
    mode: "move" | "copy";
    entry: FsEntry | null;
    targetPath: string;
  }>({ open: false, mode: "move", entry: null, targetPath: "" });
  const [snackbar, setSnackbar] = useState<{
    message: string;
    severity: "success" | "error";
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [moveCopyLoading, setMoveCopyLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const pathParts = formatPath(currentPath);

  const loadEntries = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchListForTree(currentPath || "/")
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  useEffect(() => {
    const cancel = loadEntries();
    return () => cancel?.();
  }, [loadEntries, refreshKey]);

  const handleBreadcrumb = useCallback(
    (index: number) => {
      if (index < 0) {
        onPathChange("/");
        return;
      }
      const p = `/${pathParts.slice(0, index + 1).join("/")}`;
      onPathChange(p);
    },
    [pathParts, onPathChange]
  );

  const handleClosePreview = useCallback(() => {
    if (previewBlobUrl) {
      revokeFileBlobUrl(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewOpen(false);
    setPreviewName("");
  }, [previewBlobUrl]);

  const handleFileClick = useCallback(
    async (entry: FsEntry) => {
      if (entry.isDirectory) {
        onPathChange(entry.path || "/");
        return;
      }
      const filePath = entry.path || "/";
      setFileActionLoading(true);
      setFileActionError(null);
      try {
        const stat = await fetchFileStat(filePath);
        if (stat.kind !== "file") return;
        const blob = await fetchFileBlob(filePath);
        const url = createFileBlobUrl(blob);
        if (isImageContentType(stat.contentType)) {
          setPreviewBlobUrl(url);
          setPreviewName(entry.name);
          setPreviewOpen(true);
        } else {
          window.open(url, "_blank", "noopener");
          setTimeout(() => revokeFileBlobUrl(url), 60_000);
        }
      } catch (e) {
        setFileActionError(e instanceof Error ? e.message : "打开文件失败");
      } finally {
        setFileActionLoading(false);
      }
    },
    [onPathChange]
  );

  const handleEntryClick = useCallback(
    (entry: FsEntry) => {
      handleFileClick(entry);
    },
    [handleFileClick]
  );

  const handleUp = useCallback(() => {
    if (pathParts.length === 0) return;
    if (pathParts.length === 1) {
      onPathChange("/");
      return;
    }
    const parent = `/${pathParts.slice(0, -1).join("/")}`;
    onPathChange(parent);
  }, [pathParts, onPathChange]);

  const handleOpenCreateDialog = useCallback(() => {
    setCreateDialogOpen(true);
    setNewFolderName("");
    setCreateError(null);
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    if (!createLoading) {
      setCreateDialogOpen(false);
      setNewFolderName("");
      setCreateError(null);
    }
  }, [createLoading]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreateError("请输入文件夹名称");
      return;
    }
    if (/[\\/:*?"<>|]/.test(name)) {
      setCreateError('文件夹名称不能包含 \\ / : * ? " < > |');
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      await createFolder(currentPath || "/", name);
      setCreateDialogOpen(false);
      setNewFolderName("");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreateLoading(false);
    }
  }, [currentPath, newFolderName]);

  const closeContextMenu = useCallback(() => {
    setContextMenuAnchor(null);
    setContextMenuEntry(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteEntry) return;
    setDeleteLoading(true);
    try {
      await deletePath(deleteEntry.path);
      setRefreshKey((k) => k + 1);
      setDeleteDialogOpen(false);
      setDeleteEntry(null);
      setSnackbar({ message: "已删除", severity: "success" });
    } catch (e) {
      setSnackbar({ message: e instanceof Error ? e.message : "删除失败", severity: "error" });
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteEntry]);

  const handleMoveCopyConfirm = useCallback(async () => {
    const { entry, targetPath: raw, mode } = moveCopyDialog;
    if (!entry) return;
    const targetPath = raw.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/") || "";
    if (!targetPath) {
      setSnackbar({ message: "请输入目标路径", severity: "error" });
      return;
    }
    const entryPathNorm = (entry.path || "").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
    if (targetPath === entryPathNorm) {
      setSnackbar({ message: "目标路径不能与源路径相同", severity: "error" });
      return;
    }
    setMoveCopyLoading(true);
    try {
      if (mode === "move") {
        await movePath(entry.path, targetPath ? `/${targetPath}` : "/");
      } else {
        await copyPath(entry.path, targetPath ? `/${targetPath}` : "/");
      }
      setRefreshKey((k) => k + 1);
      setMoveCopyDialog({ open: false, mode: "move", entry: null, targetPath: "" });
      setSnackbar({
        message: mode === "move" ? "已移动" : "已复制",
        severity: "success",
      });
    } catch (e) {
      setSnackbar({
        message: e instanceof Error ? e.message : mode === "move" ? "移动失败" : "复制失败",
        severity: "error",
      });
    } finally {
      setMoveCopyLoading(false);
    }
  }, [moveCopyDialog]);

  const MAX_FILE_BYTES = 4 * 1024 * 1024;

  const doUploadFiles = useCallback(
    async (files: File[] | FileList) => {
      const fileArray = Array.from(files);
      if (!fileArray.length) return;
      const basePath = (currentPath || "/").replace(/^\/+|\/+$/g, "");
      let ok = 0;
      setUploading(true);
      try {
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i]!;
          if (file.size > MAX_FILE_BYTES) {
            setSnackbar({ message: `${file.name} 超过 4MB，已跳过`, severity: "error" });
            continue;
          }
          const pathArg = basePath ? `${basePath}/${file.name}` : file.name;
          try {
            await uploadFile(pathArg, file);
            ok++;
          } catch (err) {
            setSnackbar({
              message:
                (err instanceof Error ? err.message : "上传失败") +
                (fileArray.length > 1 ? ` (${file.name})` : ""),
              severity: "error",
            });
          }
        }
        if (ok > 0) {
          setRefreshKey((k) => k + 1);
          setSnackbar({
            message: ok === 1 ? "已上传" : `已上传 ${ok} 个文件`,
            severity: "success",
          });
        }
      } finally {
        setUploading(false);
      }
    },
    [currentPath]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      await doUploadFiles(files);
      e.target.value = "";
    },
    [doUploadFiles]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current += 1;
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = Math.max(0, dragCountRef.current - 1);
    if (dragCountRef.current === 0) setDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      dragCountRef.current = 0;
      if (uploading) return;
      const files = e.dataTransfer?.files;
      if (files?.length) await doUploadFiles(files);
    },
    [doUploadFiles, uploading]
  );

  return (
    <Box display="flex" flexDirection="column" height="100%" overflow="hidden">
      {/* Toolbar: Up + breadcrumb (path segments only; root = no leading "/") */}
      <Toolbar
        variant="dense"
        disableGutters
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 40,
          px: 1,
          gap: 0.5,
        }}
      >
        <IconButton
          size="small"
          onClick={handleUp}
          disabled={pathParts.length === 0}
          aria-label="Up to parent"
          sx={{ mr: 0.5 }}
        >
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        {pathParts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            /
          </Typography>
        ) : (
          pathParts.map((part, i) => (
            <Typography
              key={pathParts.slice(0, i + 1).join("/")}
              component="span"
              variant="body2"
              sx={{
                cursor: "pointer",
                "&:hover": { textDecoration: "underline" },
                color: i === pathParts.length - 1 ? "text.primary" : "text.secondary",
              }}
              onClick={() => handleBreadcrumb(i)}
            >
              {i > 0 ? " / " : ""}
              {part}
            </Typography>
          ))
        )}
        <Button
          size="small"
          startIcon={<CloudUploadIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          sx={{ ml: 1 }}
          aria-label="上传"
        >
          上传
        </Button>
        <input
          type="file"
          multiple
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <Button
          size="small"
          startIcon={<CreateNewFolderIcon />}
          onClick={handleOpenCreateDialog}
          sx={{ ml: "auto" }}
          aria-label="新建文件夹"
        >
          新建文件夹
        </Button>
      </Toolbar>

      <Dialog open={createDialogOpen} onClose={handleCloseCreateDialog} maxWidth="xs" fullWidth>
        <DialogTitle>新建文件夹</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="文件夹名称"
            fullWidth
            variant="outlined"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            error={!!createError}
            helperText={createError}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateFolder();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateDialog} disabled={createLoading}>
            取消
          </Button>
          <Button onClick={handleCreateFolder} variant="contained" disabled={createLoading}>
            {createLoading ? "创建中…" : "创建"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={previewOpen}
        onClose={handleClosePreview}
        maxWidth={false}
        PaperProps={{
          sx: { maxHeight: "90vh", maxWidth: "90vw" },
        }}
      >
        <DialogTitle>{previewName}</DialogTitle>
        <DialogContent sx={{ p: 0, "&:first-of-type": { padding: 0 } }}>
          {previewBlobUrl && (
            <Box
              component="img"
              src={previewBlobUrl}
              alt={previewName}
              sx={{
                maxWidth: "100%",
                maxHeight: "80vh",
                objectFit: "contain",
                display: "block",
              }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePreview}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Menu
        open={!!contextMenuAnchor}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenuAnchor ? { top: contextMenuAnchor.y, left: contextMenuAnchor.x } : undefined
        }
        onClose={closeContextMenu}
      >
        <MenuItem
          disabled={!contextMenuEntry}
          onClick={() => {
            setDeleteEntry(contextMenuEntry);
            setDeleteDialogOpen(true);
            closeContextMenu();
          }}
        >
          删除
        </MenuItem>
        <MenuItem
          disabled={!contextMenuEntry}
          onClick={() => {
            setMoveCopyDialog({
              open: true,
              mode: "move",
              entry: contextMenuEntry,
              targetPath: "",
            });
            closeContextMenu();
          }}
        >
          移动
        </MenuItem>
        <MenuItem
          disabled={!contextMenuEntry}
          onClick={() => {
            setMoveCopyDialog({
              open: true,
              mode: "copy",
              entry: contextMenuEntry,
              targetPath: "",
            });
            closeContextMenu();
          }}
        >
          复制
        </MenuItem>
      </Menu>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          if (!deleteLoading) {
            setDeleteDialogOpen(false);
            setDeleteEntry(null);
          }
        }}
      >
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除 {deleteEntry?.name} 吗？</Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
              setDeleteEntry(null);
            }}
            disabled={deleteLoading}
          >
            取消
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            variant="contained"
            color="error"
            disabled={deleteLoading}
          >
            {deleteLoading ? "删除中…" : "确认"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={moveCopyDialog.open}
        onClose={() => !moveCopyLoading && setMoveCopyDialog((d) => ({ ...d, open: false }))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{moveCopyDialog.mode === "move" ? "移动" : "复制"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="目标路径"
            fullWidth
            variant="outlined"
            value={moveCopyDialog.targetPath}
            onChange={(e) => setMoveCopyDialog((d) => ({ ...d, targetPath: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setMoveCopyDialog((d) => ({ ...d, open: false }))}
            disabled={moveCopyLoading}
          >
            取消
          </Button>
          <Button onClick={handleMoveCopyConfirm} variant="contained" disabled={moveCopyLoading}>
            {moveCopyLoading ? "处理中…" : "确认"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* List with drag-drop */}
      <Box
        sx={{ flex: 1, overflow: "hidden", position: "relative" }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {dragOver && !uploading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
              border: "2px dashed",
              borderColor: "primary.main",
              borderRadius: 1,
            }}
          >
            <Typography variant="body1" color="primary.main">
              释放以上传
            </Typography>
          </Box>
        )}
        <Box sx={{ flex: 1, overflow: "auto", height: "100%" }}>
          {loading && (
            <Box display="flex" justifyContent="center" py={4}>
              <Typography variant="body2" color="text.secondary">
                Loading…
              </Typography>
            </Box>
          )}
          {fileActionError && (
            <Box py={1} px={2}>
              <Typography variant="body2" color="error">
                {fileActionError}
              </Typography>
            </Box>
          )}
          {error && (
            <Box py={2} px={2}>
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            </Box>
          )}
          {!loading && !error && entries.length === 0 && (
            <Box py={4} px={2} textAlign="center">
              <Typography variant="body2" color="text.secondary">
                Empty folder
              </Typography>
            </Box>
          )}
          {!loading && !error && entries.length > 0 && (
            <List dense disablePadding>
              {entries.map((entry) => (
                <ListItemButton
                  key={entry.path}
                  onClick={() => handleEntryClick(entry)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuAnchor({ x: e.clientX, y: e.clientY });
                    setContextMenuEntry(entry);
                  }}
                  disabled={fileActionLoading}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {entry.isDirectory ? (
                      <FolderIcon color="action" />
                    ) : (
                      <InsertDriveFileIcon color="action" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={entry.name}
                    primaryTypographyProps={{ variant: "body2" }}
                    secondary={
                      !entry.isDirectory && entry.size != null
                        ? `${(entry.size / 1024).toFixed(1)} KB`
                        : undefined
                    }
                    secondaryTypographyProps={{ variant: "caption" }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Box>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setSnackbar(null)}
      >
        {snackbar && (
          <Alert severity={snackbar.severity} onClose={() => setSnackbar(null)}>
            {snackbar.message}
          </Alert>
        )}
      </Snackbar>
    </Box>
  );
}
