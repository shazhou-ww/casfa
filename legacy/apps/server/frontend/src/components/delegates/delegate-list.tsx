/**
 * DelegateList — table view of direct child delegates with toolbar, pagination, and empty state.
 */

import type { DelegateListItem } from "@casfa/protocol";
import {
  Add as AddIcon,
  Block as BlockIcon,
  CloudUpload,
  InfoOutlined as InfoOutlinedIcon,
  VpnKey as KeyIcon,
  Storage,
} from "@mui/icons-material";
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
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDelegatesStore } from "../../stores/delegates-store.ts";

// ============================================================================
// Time formatting helpers
// ============================================================================

function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

function formatRelativeExpiry(epochMs: number): string {
  const diff = epochMs - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

// ============================================================================
// Status helpers
// ============================================================================

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

// ============================================================================
// Component
// ============================================================================

type DelegateListProps = {
  onCreateClick: () => void;
  onRevokeClick: (delegate: DelegateListItem) => void;
};

export function DelegateList({ onCreateClick, onRevokeClick }: DelegateListProps) {
  const navigate = useNavigate();
  const {
    delegates,
    isLoading,
    error,
    nextCursor,
    includeRevoked,
    fetchDelegates,
    fetchMore,
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

  // Re-fetch when includeRevoked changes
  useEffect(() => {
    fetchDelegates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchDelegates]);

  const handleCreateClick = useCallback(() => {
    onCreateClick();
  }, [onCreateClick]);

  const handleRowClick = useCallback(
    (delegateId: string) => {
      navigate(`/delegates/${encodeURIComponent(delegateId)}`);
    },
    [navigate]
  );

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6">Delegates</Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch checked={includeRevoked} onChange={handleToggleRevoked} size="small" />
            }
            label="Show revoked"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateClick}>
            Create Delegate
          </Button>
        </Box>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Loading (initial) */}
      {isLoading && delegates.length === 0 && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Empty state */}
      {delegates.length === 0 && !isLoading && !error && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <KeyIcon sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No delegates yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create a delegate to share access with tools or collaborators
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateClick}>
            Create Delegate
          </Button>
        </Box>
      )}

      {/* Table */}
      {delegates.length > 0 && (
        <>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="center">Depth</TableCell>
                  <TableCell align="center">Permissions</TableCell>
                  <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Created</TableCell>
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
                      hover
                      onClick={() => handleRowClick(d.delegateId)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRowClick(d.delegateId);
                      }}
                      sx={{
                        cursor: "pointer",
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
                      <TableCell align="center">
                        <Typography variant="body2">{d.depth}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Box
                          sx={{
                            display: "flex",
                            gap: 0.5,
                            justifyContent: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {d.canUpload && (
                            <Chip
                              icon={<CloudUpload />}
                              label="Upload"
                              color="primary"
                              variant="outlined"
                              size="small"
                            />
                          )}
                          {d.canManageDepot && (
                            <Chip
                              icon={<Storage />}
                              label="Depot"
                              color="secondary"
                              variant="outlined"
                              size="small"
                            />
                          )}
                          {!d.canUpload && !d.canManageDepot && (
                            <Chip label="Read only" variant="outlined" size="small" />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
                        <Typography variant="body2">{formatTime(d.createdAt)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {d.expiresAt != null ? (
                            <Tooltip title={formatTime(d.expiresAt)}>
                              <span>{formatRelativeExpiry(d.expiresAt)}</span>
                            </Tooltip>
                          ) : (
                            "Never"
                          )}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={cfg.label} color={cfg.color} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
                          {!isRevoked && (
                            <Tooltip title="Revoke">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRevokeClick(d);
                                }}
                              >
                                <BlockIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="View details">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/delegates/${encodeURIComponent(d.delegateId)}`);
                              }}
                            >
                              <InfoOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Load More */}
          {nextCursor && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button onClick={fetchMore} disabled={isLoading}>
                {isLoading ? "Loading…" : "Load More"}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
