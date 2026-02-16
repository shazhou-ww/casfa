/**
 * <DepotInfoDialog /> - Modal dialog showing detailed depot information.
 * Accessible via depot right-click context menu or "..." menu.
 */

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
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

type DepotInfo = {
  depotId: string;
  title: string | null;
  root: string | null;
  maxHistory: number;
  history: { root: string; timestamp: number }[];
  createdAt: number;
  updatedAt: number;
};

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

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

export function DepotInfoDialog({ open, depotId, onClose }: DepotInfoDialogProps) {
  const t = useExplorerT();
  const client = useExplorerStore((s) => s.client);

  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<DepotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !depotId) {
      setInfo(null);
      setError(null);
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

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("depot.info")}</DialogTitle>
      <DialogContent>
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
      </DialogContent>
    </Dialog>
  );
}
