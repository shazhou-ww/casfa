import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import KeyIcon from "@mui/icons-material/Key";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useCallback, useEffect } from "react";
import type { DelegateListItem } from "../../../types/delegate";
import { useDelegatesStore } from "../../stores/delegates-store";

function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

function formatExpiry(epochMs: number): string {
  const diff = epochMs - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

function getStatus(item: DelegateListItem): "active" | "revoked" | "expired" {
  if (item.isRevoked) return "revoked";
  if (item.expiresAt != null && item.expiresAt < Date.now()) return "expired";
  return "active";
}

const statusConfig = {
  active: { label: "Active", color: "success" as const },
  revoked: { label: "Revoked", color: "default" as const },
  expired: { label: "Expired", color: "warning" as const },
};

type DelegatesTabProps = {
  onCreateClick: () => void;
  onRevokeClick: (delegate: DelegateListItem) => void;
};

export function DelegatesTab({ onCreateClick, onRevokeClick }: DelegatesTabProps) {
  const {
    delegates,
    isLoading,
    error,
    includeRevoked,
    fetchDelegates,
    setIncludeRevoked,
  } = useDelegatesStore();

  useEffect(() => {
    fetchDelegates();
  }, [fetchDelegates]);

  const handleToggleRevoked = useCallback(
    (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setIncludeRevoked(checked);
    },
    [setIncludeRevoked]
  );

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6">Delegates</Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={includeRevoked}
                onChange={handleToggleRevoked}
                size="small"
              />
            }
            label="Show revoked"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
            Create Delegate
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading && delegates.length === 0 && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {delegates.length === 0 && !isLoading && !error && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <KeyIcon sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No delegates yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create a delegate to share access with tools or collaborators
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
            Create Delegate
          </Button>
        </Box>
      )}

      {delegates.length > 0 && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {delegates.map((d) => {
                const status = getStatus(d);
                const cfg = statusConfig[status];
                const isRevoked = status === "revoked";
                return (
                  <TableRow
                    key={d.delegateId}
                    sx={{
                      opacity: status === "active" ? 1 : 0.6,
                      textDecoration: isRevoked ? "line-through" : "none",
                    }}
                  >
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          textDecoration: isRevoked ? "line-through" : "none",
                        }}
                      >
                        {d.name || `${d.delegateId.slice(0, 16)}…`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatTime(d.createdAt)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {d.expiresAt != null
                          ? formatExpiry(d.expiresAt)
                          : "Never"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={cfg.label}
                        color={cfg.color}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">
                      {!isRevoked && (
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onRevokeClick(d)}
                          aria-label="Revoke"
                        >
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
