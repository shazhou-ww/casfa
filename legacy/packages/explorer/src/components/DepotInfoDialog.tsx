/**
 * <DepotInfoDialog /> - Modal dialog showing detailed depot information
 * with history timeline, human-readable diffs and rollback support.
 *
 * Rollback creates a new commit pointing to the selected historical root.
 * This preserves existing history timestamps and parent relationships —
 * only a new entry is prepended to the history array.
 */

import type { CommitDiffEntry, DepotDetail, HistoryEntry } from "@casfa/protocol";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import EditIcon from "@mui/icons-material/Edit";
import RestoreIcon from "@mui/icons-material/Restore";
import {
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type DepotInfoDialogProps = {
  open: boolean;
  depotId: string | null;
  onClose: () => void;
};

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Truncate long paths with ellipsis in the middle */
function ellipsisPath(path: string, maxLen = 48): string {
  if (path.length <= maxLen) return path;
  const seg = path.split("/");
  // If few segments, just do middle truncation
  if (seg.length <= 2) {
    const half = Math.floor((maxLen - 3) / 2);
    return `${path.slice(0, half)}\u2026${path.slice(-half)}`;
  }
  // Keep first and last segments, elide middle
  const first = seg[0]!;
  const last = seg[seg.length - 1]!;
  const remaining = maxLen - first.length - last.length - 5; // 5 for /…/
  if (remaining > 0 && seg.length > 3) {
    // Try to keep second segment partially
    const second = seg[1]!;
    if (second.length <= remaining) {
      return `${first}/${second}/\u2026/${last}`;
    }
  }
  return `${first}/\u2026/${last}`;
}

// ── InfoRow ──

function InfoRow({
  label,
  value,
  mono,
  copiable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copiable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", py: 0.75, gap: 1 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 120, flexShrink: 0, fontWeight: 500 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          wordBreak: "break-all",
          fontFamily: mono ? "monospace" : undefined,
          fontSize: mono ? "0.8125rem" : undefined,
        }}
      >
        {value}
      </Typography>
      {copiable && (
        <Tooltip title={copied ? "Copied!" : "Copy"}>
          <IconButton size="small" onClick={handleCopy} sx={{ mt: -0.25 }}>
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

// ── Diff entry display ──

const DIFF_COLORS: Record<string, string> = {
  added: "success.main",
  removed: "error.main",
  modified: "warning.main",
  moved: "info.main",
};

const DIFF_ICONS: Record<string, typeof AddIcon> = {
  added: AddIcon,
  removed: DeleteIcon,
  modified: EditIcon,
  moved: DriveFileMoveIcon,
};

function DiffEntryRow({ entry, typeLabel }: { entry: CommitDiffEntry; typeLabel: string }) {
  const Icon = DIFF_ICONS[entry.type] ?? EditIcon;
  const color = DIFF_COLORS[entry.type] ?? "text.secondary";
  const kindSuffix = entry.kind === "dir" ? "/" : "";

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.25,
        pl: 1,
      }}
    >
      <Icon sx={{ fontSize: 14, color }} />
      <Chip
        label={typeLabel}
        size="small"
        sx={{
          height: 18,
          fontSize: "0.6875rem",
          fontWeight: 600,
          "& .MuiChip-label": { px: 0.75 },
        }}
        color={
          entry.type === "added"
            ? "success"
            : entry.type === "removed"
              ? "error"
              : entry.type === "modified"
                ? "warning"
                : "info"
        }
        variant="outlined"
      />
      <Tooltip title={entry.type === "moved" ? `${entry.path} → ${entry.pathTo}` : entry.path}>
        <Typography
          variant="body2"
          sx={{
            fontFamily: "monospace",
            fontSize: "0.75rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {entry.type === "moved"
            ? `${ellipsisPath(entry.path, 20)}${kindSuffix} → ${ellipsisPath(entry.pathTo ?? "", 20)}${kindSuffix}`
            : `${ellipsisPath(entry.path)}${kindSuffix}`}
        </Typography>
      </Tooltip>
    </Box>
  );
}

// ── History entry ──

function HistoryEntryItem({
  entry,
  index,
  isCurrent,
  onRollback,
  rollingBack,
  t,
}: {
  entry: HistoryEntry;
  index: number;
  isCurrent: boolean;
  onRollback: (entry: HistoryEntry) => void;
  rollingBack: boolean;
  t: ReturnType<typeof useExplorerT>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDiff = entry.diff && entry.diff.length > 0;

  const diffTypeLabel = useCallback(
    (type: string) => {
      switch (type) {
        case "added":
          return t("depot.historyDiffAdded");
        case "removed":
          return t("depot.historyDiffRemoved");
        case "modified":
          return t("depot.historyDiffModified");
        case "moved":
          return t("depot.historyDiffMoved");
        default:
          return type;
      }
    },
    [t]
  );

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 1,
          px: 1,
          borderRadius: 1,
          cursor: hasDiff ? "pointer" : "default",
          "&:hover": { bgcolor: "action.hover" },
          transition: "background-color 0.15s",
        }}
        onClick={() => hasDiff && setExpanded((v) => !v)}
      >
        {/* Timeline dot + line */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexShrink: 0,
            width: 20,
          }}
        >
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: isCurrent ? "primary.main" : "grey.400",
              border: isCurrent ? "2px solid" : "none",
              borderColor: "primary.light",
            }}
          />
        </Box>

        {/* Main content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: isCurrent ? 600 : 400 }}>
              {formatDateTime(entry.timestamp)}
            </Typography>
            {isCurrent && (
              <Chip
                label={t("depot.historyCurrent")}
                size="small"
                color="primary"
                sx={{
                  height: 18,
                  fontSize: "0.6875rem",
                  "& .MuiChip-label": { px: 0.75 },
                }}
              />
            )}
          </Box>
          <Typography
            variant="caption"
            sx={{
              fontFamily: "monospace",
              color: "text.secondary",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.root}
          </Typography>
          {hasDiff && (
            <Typography variant="caption" color="text.secondary">
              {entry.diff!.length} {entry.diffTruncated ? "+" : ""}{" "}
              {entry.diff!.length === 1 ? "change" : "changes"}
              {expanded ? " ▴" : " ▾"}
            </Typography>
          )}
          {!hasDiff && !isCurrent && (
            <Typography variant="caption" color="text.disabled">
              {t("depot.historyDiffNone")}
            </Typography>
          )}
        </Box>

        {/* Rollback button — not shown on current version */}
        {!isCurrent && (
          <Tooltip title={t("depot.historyRollback")}>
            <span>
              <IconButton
                size="small"
                disabled={rollingBack}
                onClick={(e) => {
                  e.stopPropagation();
                  onRollback(entry);
                }}
                sx={{ flexShrink: 0 }}
              >
                {rollingBack ? (
                  <CircularProgress size={16} />
                ) : (
                  <RestoreIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      {/* Expanded diff entries */}
      <Collapse in={expanded}>
        <Box sx={{ pl: 4, pb: 1 }}>
          {entry.diff?.map((diff, i) => (
            <DiffEntryRow
              key={`${diff.path}-${i}`}
              entry={diff}
              typeLabel={diffTypeLabel(diff.type)}
            />
          ))}
          {entry.diffTruncated && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ pl: 1, fontStyle: "italic" }}
            >
              {t("depot.historyDiffTruncated")}
            </Typography>
          )}
        </Box>
      </Collapse>

      <Divider />
    </Box>
  );
}

// ── Main dialog ──

export function DepotInfoDialog({ open, depotId, onClose }: DepotInfoDialogProps) {
  const t = useExplorerT();
  const client = useExplorerStore((s) => s.client);
  const selectDepot = useExplorerStore((s) => s.selectDepot);

  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<DepotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    if (!open || !depotId) {
      setInfo(null);
      setError(null);
      setTab(0);
      setRollbackTarget(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    client.depots
      .get(depotId)
      .then((result) => {
        if (cancelled) return;
        if ("error" in result) {
          setError(t("error.unknown"));
        } else {
          setInfo(result.data);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t("error.network"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, depotId, client, t]);

  /** Reload depot info after rollback */
  const reloadInfo = useCallback(() => {
    if (!depotId) return;
    client.depots.get(depotId).then((result) => {
      if (!("error" in result)) setInfo(result.data);
    });
  }, [depotId, client]);

  /** Handle rollback: commit the old root as the new root */
  const handleRollback = useCallback(
    async (entry: HistoryEntry) => {
      if (!depotId || !info) return;

      const confirmMsg = t("depot.historyRollbackConfirm", {
        time: formatDateTime(entry.timestamp),
      });
      if (!window.confirm(confirmMsg)) return;

      setRollingBack(true);
      setRollbackTarget(entry);
      try {
        const result = await client.depots.commit(depotId, { root: entry.root });
        if ("error" in result) {
          setError(t("depot.historyRollbackError"));
        } else {
          // Refresh depot info and explorer view
          reloadInfo();
          selectDepot(depotId);
        }
      } catch {
        setError(t("depot.historyRollbackError"));
      } finally {
        setRollingBack(false);
        setRollbackTarget(null);
      }
    },
    [depotId, info, client, t, reloadInfo, selectDepot]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("depot.info")}</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {error && (
          <Box sx={{ py: 2 }}>
            <Typography color="error">{error}</Typography>
          </Box>
        )}

        {!loading && !error && info && (
          <>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              sx={{ mb: 1, minHeight: 36 }}
              variant="fullWidth"
            >
              <Tab label={t("depot.infoTab")} sx={{ minHeight: 36, py: 0.5 }} />
              <Tab label={t("depot.historyTab")} sx={{ minHeight: 36, py: 0.5 }} />
            </Tabs>

            {/* ── Info tab ── */}
            {tab === 0 && (
              <Box sx={{ py: 1 }}>
                <InfoRow label={t("depot.infoTitle")} value={info.title || t("depot.untitled")} />
                <InfoRow label={t("depot.infoId")} value={info.depotId} mono copiable />
                <InfoRow
                  label={t("depot.infoRoot")}
                  value={info.root || "—"}
                  mono
                  copiable={!!info.root}
                />
                <InfoRow label={t("depot.infoMaxHistory")} value={String(info.maxHistory)} />
                <InfoRow label={t("depot.infoHistoryCount")} value={String(info.history.length)} />
                <InfoRow label={t("depot.infoCreatedAt")} value={formatDateTime(info.createdAt)} />
                <InfoRow label={t("depot.infoUpdatedAt")} value={formatDateTime(info.updatedAt)} />
              </Box>
            )}

            {/* ── History tab ── */}
            {tab === 1 && (
              <Box
                sx={{
                  py: 1,
                  maxHeight: 400,
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                {info.history.length === 0 ? (
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                    {t("depot.historyEmpty")}
                  </Typography>
                ) : (
                  info.history.map((entry, idx) => (
                    <HistoryEntryItem
                      key={`${entry.root}-${entry.timestamp}`}
                      entry={entry}
                      index={idx}
                      isCurrent={idx === 0}
                      onRollback={handleRollback}
                      rollingBack={rollingBack && rollbackTarget?.root === entry.root}
                      t={t}
                    />
                  ))
                )}
              </Box>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
