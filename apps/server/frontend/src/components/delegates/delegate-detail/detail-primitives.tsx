/**
 * Shared primitives, helpers and types for delegate detail view.
 */

import type { DelegateDetail } from "@casfa/protocol";
import {
  Check as CheckIcon,
  ContentCopy as ContentCopyIcon,
} from "@mui/icons-material";
import {
  Box,
  Chip,
  Divider,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";

// -- Types ------------------------------------------------------------------

export type NotifyFn = (message: string, severity?: "success" | "error" | "info") => void;

// -- Time helpers -----------------------------------------------------------

export function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

export function formatRelativeExpiry(epochMs: number): string {
  const diff = epochMs - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

// -- Status helpers ---------------------------------------------------------

export function getStatus(d: DelegateDetail): "active" | "revoked" | "expired" {
  if (d.isRevoked) return "revoked";
  if (d.expiresAt != null && d.expiresAt < Date.now()) return "expired";
  return "active";
}

export const statusConfig = {
  active: { label: "Active", color: "success" as const, barColor: "#059669" },
  revoked: { label: "Revoked", color: "default" as const, barColor: "#a1a1aa" },
  expired: { label: "Expired", color: "warning" as const, barColor: "#d97706" },
};

// -- Section card -----------------------------------------------------------

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box
        sx={{
          px: 2.5,
          py: 1.5,
          bgcolor: "rgba(0, 0, 0, 0.015)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: "0.02em" }}>
          {title}
        </Typography>
      </Box>
      <Box sx={{ px: 2.5, py: 2 }}>{children}</Box>
    </Paper>
  );
}

// -- InfoRow ----------------------------------------------------------------

export function InfoRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <>
      <Box sx={{ display: "flex", gap: 2, py: 1, alignItems: "center" }}>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ width: 140, flexShrink: 0, fontWeight: 500 }}
        >
          {label}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </Box>
      {!last && <Divider sx={{ opacity: 0.5 }} />}
    </>
  );
}

// -- CopyButton -------------------------------------------------------------

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <Tooltip title={copied ? "Copied!" : "Copy"}>
      <IconButton size="small" onClick={handleCopy}>
        {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

// -- PermissionCard ---------------------------------------------------------

export function PermissionCard({
  icon,
  label,
  allowed,
}: {
  icon: React.ReactNode;
  label: string;
  allowed: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderRadius: 1,
        bgcolor: allowed ? "rgba(5, 150, 105, 0.06)" : "rgba(0, 0, 0, 0.02)",
        border: "1px solid",
        borderColor: allowed ? "rgba(5, 150, 105, 0.2)" : "divider",
        flex: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{ color: allowed ? "success.main" : "action.disabled", display: "flex" }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        <Typography variant="caption" color={allowed ? "success.main" : "text.secondary"}>
          {allowed ? "Allowed" : "Denied"}
        </Typography>
      </Box>
    </Box>
  );
}

// -- CopyableChip -----------------------------------------------------------

export function CopyableChip({
  value,
  maxLen,
  onNotify,
  notifyMessage,
  icon,
}: {
  value: string;
  maxLen: number;
  onNotify?: NotifyFn;
  notifyMessage: string;
  icon?: React.ReactElement;
}) {
  return (
    <Tooltip title={value}>
      <Chip
        icon={icon}
        label={value.length > maxLen ? value.slice(0, maxLen) + "…" : value}
        size="small"
        variant="outlined"
        sx={{ fontFamily: "monospace", fontSize: "0.8em", cursor: "pointer" }}
        onClick={() => {
          navigator.clipboard.writeText(value);
          onNotify?.(notifyMessage, "info");
        }}
      />
    </Tooltip>
  );
}
