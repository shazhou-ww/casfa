/**
 * <FileList /> - List view for directory contents.
 *
 * Iter 2: Added multi-select support and right-click context menu trigger.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  Box,
  Checkbox,
  CircularProgress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ExplorerItem } from "../types.ts";

function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return "\u2014";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function getDisplayType(item: ExplorerItem): string {
  if (item.isDirectory) return "Folder";
  if (item.contentType) return item.contentType;
  return "File";
}

type FileListProps = {
  onNavigate?: (path: string) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: ExplorerItem | null) => void;
  renderEmptyState?: () => React.ReactNode;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;
};

export function FileList({
  onNavigate,
  onFileOpen,
  onContextMenu,
  renderEmptyState,
  renderNodeIcon,
}: FileListProps) {
  const t = useExplorerT();
  const items = useExplorerStore((s) => s.items);
  const isLoading = useExplorerStore((s) => s.isLoading);
  const hasMore = useExplorerStore((s) => s.hasMore);
  const loadMore = useExplorerStore((s) => s.loadMore);
  const navigate = useExplorerStore((s) => s.navigate);
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const setSelectedItems = useExplorerStore((s) => s.setSelectedItems);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedPaths = new Set(selectedItems.map((i) => i.path));

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const handleRowClick = useCallback(
    (item: ExplorerItem, e: React.MouseEvent) => {
      // Ctrl/Cmd+click for multi-select
      if (e.metaKey || e.ctrlKey) {
        if (selectedPaths.has(item.path)) {
          setSelectedItems(selectedItems.filter((i) => i.path !== item.path));
        } else {
          setSelectedItems([...selectedItems, item]);
        }
        return;
      }

      // Normal click → single select, then navigate/open
      setSelectedItems([item]);
    },
    [selectedItems, selectedPaths, setSelectedItems],
  );

  const handleRowDoubleClick = useCallback(
    (item: ExplorerItem) => {
      if (item.isDirectory) {
        navigate(item.path);
        onNavigate?.(item.path);
      } else {
        onFileOpen?.(item);
      }
    },
    [navigate, onNavigate, onFileOpen],
  );

  const handleRowContextMenu = useCallback(
    (item: ExplorerItem, e: React.MouseEvent) => {
      e.preventDefault();
      // If right-clicked item is not selected, select only it
      if (!selectedPaths.has(item.path)) {
        setSelectedItems([item]);
      }
      onContextMenu?.(e, item);
    },
    [selectedPaths, setSelectedItems, onContextMenu],
  );

  const handleBlankContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Only if clicking the container (not a row)
      if ((e.target as HTMLElement).closest("tr")) return;
      e.preventDefault();
      setSelectedItems([]);
      onContextMenu?.(e, null);
    },
    [setSelectedItems, onContextMenu],
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedItems([...items]);
      } else {
        setSelectedItems([]);
      }
    },
    [items, setSelectedItems],
  );

  const sorted = [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (isLoading && items.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} height={40} sx={{ mb: 0.5 }} />
        ))}
      </Box>
    );
  }

  if (!isLoading && items.length === 0) {
    if (renderEmptyState) {
      return <>{renderEmptyState()}</>;
    }
    return (
      <Box
        sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 8, flex: 1 }}
        onContextMenu={handleBlankContextMenu}
      >
        <Typography color="text.secondary">{t("fileList.empty")}</Typography>
      </Box>
    );
  }

  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const someSelected = selectedItems.length > 0 && !allSelected;

  return (
    <TableContainer onContextMenu={handleBlankContextMenu}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ width: 42 }}>
              <Checkbox
                size="small"
                checked={allSelected}
                indeterminate={someSelected}
                onChange={(_, checked) => handleSelectAll(checked)}
              />
            </TableCell>
            <TableCell sx={{ fontWeight: 600, width: "50%" }}>{t("fileList.name")}</TableCell>
            <TableCell sx={{ fontWeight: 600, width: "20%" }} align="right">
              {t("fileList.size")}
            </TableCell>
            <TableCell sx={{ fontWeight: 600, width: "25%" }}>{t("fileList.type")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((item) => {
            const isSelected = selectedPaths.has(item.path);
            return (
              <TableRow
                key={item.path}
                hover
                selected={isSelected}
                onClick={(e) => handleRowClick(item, e)}
                onDoubleClick={() => handleRowDoubleClick(item)}
                onContextMenu={(e) => handleRowContextMenu(item, e)}
                sx={{ cursor: "pointer", "&:last-child td": { borderBottom: 0 } }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(_, checked) => {
                      if (checked) {
                        setSelectedItems([...selectedItems, item]);
                      } else {
                        setSelectedItems(selectedItems.filter((i) => i.path !== item.path));
                      }
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {renderNodeIcon ? (
                      renderNodeIcon(item)
                    ) : item.isDirectory ? (
                      <FolderIcon fontSize="small" color="primary" />
                    ) : (
                      <InsertDriveFileIcon fontSize="small" color="action" />
                    )}
                    <Typography variant="body2" noWrap>
                      {item.name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" color="text.secondary">
                    {item.isDirectory ? `${item.childCount ?? "\u2014"}` : formatFileSize(item.size)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {getDisplayType(item)}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {hasMore && (
        <Box ref={sentinelRef} sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}
    </TableContainer>
  );
}
