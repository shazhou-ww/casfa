import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import DownloadOutlined from "@mui/icons-material/DownloadOutlined";
import {
  Checkbox,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import type { FsLsChild } from "../../../api/types";
import { useAuth } from "../../../auth/auth-context";
import { ConfirmDialog } from "../../../components/common/confirm-dialog";
import { FileIcon } from "../../../components/common/file-icon";
import { useFileDownload } from "../../../hooks/use-file-download";
import { useFileMutations } from "../../../hooks/use-file-mutations";
import { useKeyboardShortcuts } from "../../../hooks/use-keyboard-shortcuts";
import { useFileBrowserStore } from "../../../stores/file-browser-store";
import { ContextMenu } from "./context-menu";
import { MoveCopyDialog } from "./move-copy-dialog";
import { RenameDialog } from "./rename-dialog";

type FileListProps = {
  items: FsLsChild[];
  onPreview?: (item: FsLsChild) => void;
};

function formatSize(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({ items, onPreview }: FileListProps) {
  const { user } = useAuth();
  const realm = user?.realm ?? null;
  const { currentPath, currentDepotId, selection, toggleSelect, setPath } = useFileBrowserStore();
  const ctx = realm && currentDepotId ? { realm, depotId: currentDepotId } : null;
  const { rm } = useFileMutations(realm, ctx);
  const { download } = useFileDownload();

  // Context menu state
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [menuItem, setMenuItem] = useState<FsLsChild | null>(null);

  // Dialog state
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [moveCopyTarget, setMoveCopyTarget] = useState<string | null>(null);
  const [moveCopyMode, setMoveCopyMode] = useState<"move" | "copy">("move");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [items]
  );

  const allNames = useMemo(() => sorted.map((c) => c.name), [sorted]);

  const handleClick = (item: FsLsChild) => {
    if (item.type === "directory") {
      const newPath = currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;
      setPath(newPath);
    } else if (onPreview) {
      onPreview(item);
    }
  };

  const handleDelete = async (name: string) => {
    const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    await rm.mutateAsync(path);
  };

  const handleContextMenu = (e: React.MouseEvent, item: FsLsChild) => {
    e.preventDefault();
    setMenuPos({ top: e.clientY, left: e.clientX });
    setMenuItem(item);
  };

  const handleBulkDelete = useCallback(async () => {
    setDeleteConfirmOpen(false);
    for (const name of selection) {
      const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
      await rm.mutateAsync(path);
    }
  }, [selection, currentPath, rm]);

  const handleDeleteShortcut = useCallback(() => {
    if (selection.size > 0) setDeleteConfirmOpen(true);
  }, [selection]);

  const handleRenameShortcut = useCallback(() => {
    if (selection.size === 1) {
      const name = [...selection][0]!;
      setRenameTarget(name);
    }
  }, [selection]);

  useKeyboardShortcuts({
    onDelete: handleDeleteShortcut,
    onRename: handleRenameShortcut,
    allNames,
  });

  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>Name</TableCell>
            <TableCell align="right">Size</TableCell>
            <TableCell>Type</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((item) => (
            <TableRow
              key={item.name}
              hover
              selected={selection.has(item.name)}
              sx={{ cursor: "pointer" }}
              onClick={() => handleClick(item)}
              onContextMenu={(e) => handleContextMenu(e, item)}
            >
              <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selection.has(item.name)}
                  onChange={() => toggleSelect(item.name)}
                  size="small"
                />
              </TableCell>
              <TableCell>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileIcon type={item.type} contentType={item.contentType} name={item.name} />
                  {item.name}
                </span>
              </TableCell>
              <TableCell align="right">{formatSize(item.size)}</TableCell>
              <TableCell>
                {item.contentType ?? (item.type === "directory" ? "Folder" : "-")}
              </TableCell>
              <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                {item.type === "file" && (
                  <IconButton size="small" title="Download" onClick={() => download(item.name)}>
                    <DownloadOutlined fontSize="small" />
                  </IconButton>
                )}
                <IconButton
                  size="small"
                  title="Delete"
                  onClick={() => handleDelete(item.name)}
                  color="error"
                >
                  <DeleteOutlined fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ContextMenu
        anchorPosition={menuPos}
        item={menuItem}
        onClose={() => setMenuPos(null)}
        onOpen={() => menuItem && handleClick(menuItem)}
        onDownload={() => menuItem && download(menuItem.name)}
        onRename={() => menuItem && setRenameTarget(menuItem.name)}
        onMove={() => {
          if (menuItem) {
            setMoveCopyTarget(menuItem.name);
            setMoveCopyMode("move");
          }
        }}
        onCopy={() => {
          if (menuItem) {
            setMoveCopyTarget(menuItem.name);
            setMoveCopyMode("copy");
          }
        }}
        onDelete={() => menuItem && handleDelete(menuItem.name)}
      />

      <RenameDialog
        open={!!renameTarget}
        currentName={renameTarget ?? ""}
        onClose={() => setRenameTarget(null)}
        realm={realm}
      />

      <MoveCopyDialog
        open={!!moveCopyTarget}
        mode={moveCopyMode}
        itemName={moveCopyTarget ?? ""}
        onClose={() => setMoveCopyTarget(null)}
        realm={realm}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete selected items?"
        message={`${selection.size} item(s) will be permanently deleted.`}
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </>
  );
}
