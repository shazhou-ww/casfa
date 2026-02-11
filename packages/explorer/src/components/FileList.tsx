/**
 * <FileList /> - List view for directory contents.
 *
 * Iter 2: Added multi-select support and right-click context menu trigger.
 * Iter 3: Added column sorting with TableSortLabel, search highlight,
 *         uses store's getSortedItems() for filtered + sorted data.
 */

import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
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
  TableSortLabel,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import { useHighlightMatch } from "../hooks/use-search.ts";
import type { ExplorerItem, SortField } from "../types.ts";

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

/** Inline name with search term highlighting */
function HighlightedName({ name, searchTerm }: { name: string; searchTerm: string }) {
  const segments = useHighlightMatch(name, searchTerm);
  return (
    <Typography variant="body2" noWrap component="span">
      {segments.map((seg, i) =>
        seg.highlight ? (
          <Box
            component="span"
            // biome-ignore lint/suspicious/noArrayIndexKey: segments derived from search positions
            key={i}
            sx={{ backgroundColor: "warning.light", borderRadius: 0.5 }}
          >
            {seg.text}
          </Box>
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments derived from search positions
            key={i}
          >
            {seg.text}
          </span>
        )
      )}
    </Typography>
  );
}

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
  const getSortedItems = useExplorerStore((s) => s.getSortedItems);
  const sortField = useExplorerStore((s) => s.sortField);
  const sortDirection = useExplorerStore((s) => s.sortDirection);
  const setSort = useExplorerStore((s) => s.setSort);
  const searchTerm = useExplorerStore((s) => s.searchTerm);

  const sorted = getSortedItems();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedPaths = useMemo(() => new Set(selectedItems.map((i) => i.path)), [selectedItems]);

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
      { threshold: 0.1 }
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
    [selectedItems, selectedPaths, setSelectedItems]
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
    [navigate, onNavigate, onFileOpen]
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
    [selectedPaths, setSelectedItems, onContextMenu]
  );

  const handleBlankContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Only if clicking the container (not a row)
      if ((e.target as HTMLElement).closest("tr")) return;
      e.preventDefault();
      setSelectedItems([]);
      onContextMenu?.(e, null);
    },
    [setSelectedItems, onContextMenu]
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedItems([...items]);
      } else {
        setSelectedItems([]);
      }
    },
    [items, setSelectedItems]
  );

  if (isLoading && items.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders never reorder
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
        <Typography color="text.secondary">
          {searchTerm ? t("search.noResults") : t("fileList.empty")}
        </Typography>
      </Box>
    );
  }

  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const someSelected = selectedItems.length > 0 && !allSelected;

  const sortColumns: Array<{ field: SortField; label: string; width: string; align?: "right" }> = [
    { field: "name", label: t("fileList.name"), width: "50%" },
    { field: "size", label: t("fileList.size"), width: "20%", align: "right" },
    { field: "type", label: t("fileList.type"), width: "25%" },
  ];

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
            {sortColumns.map((col) => (
              <TableCell
                key={col.field}
                sx={{ fontWeight: 600, width: col.width }}
                align={col.align as "right" | undefined}
              >
                <TableSortLabel
                  active={sortField === col.field}
                  direction={sortField === col.field ? sortDirection : "asc"}
                  onClick={() => setSort(col.field)}
                >
                  {col.label}
                </TableSortLabel>
              </TableCell>
            ))}
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
                    <HighlightedName name={item.name} searchTerm={searchTerm} />
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" color="text.secondary">
                    {item.isDirectory
                      ? `${item.childCount ?? "\u2014"}`
                      : formatFileSize(item.size)}
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
