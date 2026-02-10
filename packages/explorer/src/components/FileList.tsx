/**
 * <FileList /> - List view for directory contents.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  Box,
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
  renderEmptyState?: () => React.ReactNode;
  renderNodeIcon?: (item: ExplorerItem) => React.ReactNode;
};

export function FileList({
  onNavigate,
  onFileOpen,
  renderEmptyState,
  renderNodeIcon,
}: FileListProps) {
  const t = useExplorerT();
  const items = useExplorerStore((s) => s.items);
  const isLoading = useExplorerStore((s) => s.isLoading);
  const hasMore = useExplorerStore((s) => s.hasMore);
  const loadMore = useExplorerStore((s) => s.loadMore);
  const navigate = useExplorerStore((s) => s.navigate);

  const sentinelRef = useRef<HTMLDivElement>(null);

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
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 8 }}>
        <Typography color="text.secondary">{t("fileList.empty")}</Typography>
      </Box>
    );
  }

  return (
    <TableContainer>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, width: "55%" }}>{t("fileList.name")}</TableCell>
            <TableCell sx={{ fontWeight: 600, width: "20%" }} align="right">
              {t("fileList.size")}
            </TableCell>
            <TableCell sx={{ fontWeight: 600, width: "25%" }}>{t("fileList.type")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((item) => (
            <TableRow
              key={item.path}
              hover
              onClick={() => handleRowClick(item)}
              sx={{ cursor: "pointer", "&:last-child td": { borderBottom: 0 } }}
            >
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
          ))}
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
