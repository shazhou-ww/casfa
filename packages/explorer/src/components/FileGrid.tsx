/**
 * <FileGrid /> - Grid/icon view for directory contents.
 * (Iter 3)
 *
 * Displays items as icon + name tiles with responsive column count.
 * Supports single-click select, double-click open, right-click context menu.
 */

import AudioFileIcon from "@mui/icons-material/AudioFile";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import CodeIcon from "@mui/icons-material/Code";
import DescriptionIcon from "@mui/icons-material/Description";
import FolderIcon from "@mui/icons-material/Folder";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VideoFileIcon from "@mui/icons-material/VideoFile";
import { Box, CircularProgress, Skeleton, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import { useHighlightMatch } from "../hooks/use-search.ts";
import type { ExplorerItem } from "../types.ts";
import { getIconCategory, type IconCategory } from "../utils/icon-map.ts";

// ── Icon resolver ──

function getGridIcon(category: IconCategory) {
  switch (category) {
    case "folder":
      return <FolderIcon sx={{ fontSize: 40, color: "primary.main" }} />;
    case "image":
      return <ImageIcon sx={{ fontSize: 40, color: "secondary.main" }} />;
    case "video":
      return <VideoFileIcon sx={{ fontSize: 40, color: "error.main" }} />;
    case "audio":
      return <AudioFileIcon sx={{ fontSize: 40, color: "info.main" }} />;
    case "pdf":
      return <PictureAsPdfIcon sx={{ fontSize: 40, color: "error.main" }} />;
    case "code":
      return <CodeIcon sx={{ fontSize: 40, color: "info.main" }} />;
    case "document":
    case "text":
    case "spreadsheet":
    case "presentation":
      return <DescriptionIcon sx={{ fontSize: 40, color: "action.active" }} />;
    default:
      return <InsertDriveFileIcon sx={{ fontSize: 40, color: "action.active" }} />;
  }
}

// ── Grid item ──

type GridItemProps = {
  item: ExplorerItem;
  isSelected: boolean;
  isCut: boolean;
  isFocused: boolean;
  searchTerm: string;
  onSelect: (item: ExplorerItem, e: React.MouseEvent) => void;
  onOpen: (item: ExplorerItem) => void;
  onContextMenu: (item: ExplorerItem, e: React.MouseEvent) => void;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;
};

function GridItem({
  item,
  isSelected,
  isCut,
  isFocused,
  searchTerm,
  onSelect,
  onOpen,
  onContextMenu,
  renderNodeIcon,
}: GridItemProps) {
  const category = getIconCategory(item.isDirectory, item.contentType);
  const segments = useHighlightMatch(item.name, searchTerm);

  return (
    <Box
      onClick={(e) => onSelect(item, e)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(item, e);
      }}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        p: 1,
        borderRadius: 1,
        cursor: "pointer",
        backgroundColor: isSelected ? "action.selected" : "transparent",
        "&:hover": {
          backgroundColor: isSelected ? "action.selected" : "action.hover",
        },
        minHeight: 100,
        overflow: "hidden",
        opacity: isCut ? 0.5 : 1,
        ...(isFocused && {
          outline: "2px dashed",
          outlineColor: "primary.main",
          outlineOffset: -2,
        }),
      }}
    >
      <Box sx={{ position: "relative", display: "inline-flex" }}>
        {renderNodeIcon ? renderNodeIcon(item) : getGridIcon(category)}
        {item.syncStatus === "pending" && (
          <CloudSyncIcon
            color="info"
            sx={{
              position: "absolute",
              right: -4,
              bottom: -4,
              fontSize: 14,
            }}
          />
        )}
      </Box>
      <Typography
        variant="caption"
        align="center"
        sx={{
          mt: 0.5,
          width: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          wordBreak: "break-all",
          lineHeight: 1.3,
        }}
      >
        {segments.map((seg, i) =>
          seg.highlight ? (
            <Box
              component="span"
              // biome-ignore lint/suspicious/noArrayIndexKey: segments derived from search match positions
              key={i}
              sx={{ backgroundColor: "warning.light", borderRadius: 0.5 }}
            >
              {seg.text}
            </Box>
          ) : (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: segments derived from search match positions
              key={i}
            >
              {seg.text}
            </span>
          )
        )}
      </Typography>
    </Box>
  );
}

// ── FileGrid ──

type FileGridProps = {
  onNavigate?: (path: string) => void;
  onFileOpen?: (item: ExplorerItem) => void;
  onContextMenu?: (e: React.MouseEvent, item: ExplorerItem | null) => void;
  renderEmptyState?: () => React.ReactNode;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;
  /** Paths of items currently cut to clipboard (shown at reduced opacity) */
  cutPaths?: Set<string> | null;
};

export function FileGrid({
  onNavigate,
  onFileOpen,
  onContextMenu,
  renderEmptyState,
  renderNodeIcon,
  cutPaths,
}: FileGridProps) {
  const t = useExplorerT();
  const isLoading = useExplorerStore((s) => s.isLoading);
  const hasMore = useExplorerStore((s) => s.hasMore);
  const loadMore = useExplorerStore((s) => s.loadMore);
  const navigate = useExplorerStore((s) => s.navigate);
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const setSelectedItems = useExplorerStore((s) => s.setSelectedItems);
  const getSortedItems = useExplorerStore((s) => s.getSortedItems);
  const searchTerm = useExplorerStore((s) => s.searchTerm);
  const focusIndex = useExplorerStore((s) => s.focusIndex);
  const lastSelectedIndex = useExplorerStore((s) => s.lastSelectedIndex);
  const setLastSelectedIndex = useExplorerStore((s) => s.setLastSelectedIndex);

  const items = getSortedItems();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedPaths = useMemo(() => new Set(selectedItems.map((i) => i.path)), [selectedItems]);

  // Infinite scroll sentinel
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore) loadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const handleSelect = useCallback(
    (item: ExplorerItem, e: React.MouseEvent) => {
      const itemIndex = items.findIndex((i) => i.path === item.path);

      // Shift+click for range selection
      if (e.shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, itemIndex);
        const end = Math.max(lastSelectedIndex, itemIndex);
        const rangeItems = items.slice(start, end + 1);
        if (e.metaKey || e.ctrlKey) {
          const existing = new Set(selectedItems.map((i) => i.path));
          const merged = [...selectedItems];
          for (const ri of rangeItems) {
            if (!existing.has(ri.path)) merged.push(ri);
          }
          setSelectedItems(merged);
        } else {
          setSelectedItems(rangeItems);
        }
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (selectedPaths.has(item.path)) {
          setSelectedItems(selectedItems.filter((i) => i.path !== item.path));
        } else {
          setSelectedItems([...selectedItems, item]);
        }
        setLastSelectedIndex(itemIndex);
        return;
      }
      setSelectedItems([item]);
      setLastSelectedIndex(itemIndex);
    },
    [selectedItems, selectedPaths, setSelectedItems, items, lastSelectedIndex, setLastSelectedIndex]
  );

  const handleOpen = useCallback(
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

  const handleItemContextMenu = useCallback(
    (item: ExplorerItem, e: React.MouseEvent) => {
      if (!selectedPaths.has(item.path)) {
        setSelectedItems([item]);
      }
      onContextMenu?.(e, item);
    },
    [selectedPaths, setSelectedItems, onContextMenu]
  );

  const handleBlankContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-grid-item]")) return;
      e.preventDefault();
      setSelectedItems([]);
      onContextMenu?.(e, null);
    },
    [setSelectedItems, onContextMenu]
  );

  if (isLoading && items.length === 0) {
    return (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 1,
          p: 2,
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
          <Skeleton key={i} variant="rounded" height={100} />
        ))}
      </Box>
    );
  }

  if (!isLoading && items.length === 0) {
    if (renderEmptyState) return <>{renderEmptyState()}</>;
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

  return (
    <Box onContextMenu={handleBlankContextMenu} sx={{ flex: 1 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 1,
          p: 1,
        }}
      >
        {items.map((item, idx) => (
          <Box key={item.path} data-grid-item>
            <GridItem
              item={item}
              isSelected={selectedPaths.has(item.path)}
              isCut={cutPaths?.has(item.path) ?? false}
              isFocused={focusIndex === idx}
              searchTerm={searchTerm}
              onSelect={handleSelect}
              onOpen={handleOpen}
              onContextMenu={handleItemContextMenu}
              renderNodeIcon={renderNodeIcon}
            />
          </Box>
        ))}
      </Box>
      {hasMore && (
        <Box ref={sentinelRef} sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}
    </Box>
  );
}
