/**
 * CreateDelegateDialog — form dialog for creating a child delegate.
 *
 * Fields: name, canUpload, canManageDepot, delegatedDepots, scope (fixed),
 * tokenTtl, delegate expiry.
 */

import type { CreateDelegateResponse } from "@casfa/protocol";
import type { DepotListItem } from "@casfa/protocol";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { getAppClient } from "../../lib/client.ts";

// ============================================================================
// Types
// ============================================================================

type CreateDelegateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (response: CreateDelegateResponse) => void;
};

// ============================================================================
// Constants
// ============================================================================

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
];

// ============================================================================
// Component
// ============================================================================

export function CreateDelegateDialog({ open, onClose, onCreated }: CreateDelegateDialogProps) {
  // Form fields
  const [name, setName] = useState("");
  const [canUpload, setCanUpload] = useState(false);
  const [canManageDepot, setCanManageDepot] = useState(false);
  const [selectedDepots, setSelectedDepots] = useState<DepotListItem[]>([]);
  const [tokenTtl, setTokenTtl] = useState(86400); // default 24h
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryValue, setExpiryValue] = useState(24);
  const [expiryUnit, setExpiryUnit] = useState<"hours" | "days">("hours");

  // Depot list for autocomplete
  const [depots, setDepots] = useState<DepotListItem[]>([]);
  const [depotsLoading, setDepotsLoading] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch depots when dialog opens and canManageDepot is true
  useEffect(() => {
    if (!open || !canManageDepot) return;
    setDepotsLoading(true);
    getAppClient().then((client) =>
      client.depots
        .list({ limit: 100 })
        .then((result) => {
          if (result.ok) setDepots(result.data.depots);
        })
        .finally(() => setDepotsLoading(false))
    );
  }, [open, canManageDepot]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName("");
      setCanUpload(false);
      setCanManageDepot(false);
      setSelectedDepots([]);
      setTokenTtl(86400);
      setHasExpiry(false);
      setExpiryValue(24);
      setExpiryUnit("hours");
      setError(null);
    }
  }, [open]);

  // Compute expiry in seconds for validation
  const expiresInSeconds = hasExpiry
    ? expiryValue * (expiryUnit === "days" ? 86400 : 3600)
    : Infinity;
  const ttlExceedsLifetime = hasExpiry && tokenTtl > expiresInSeconds;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const client = await getAppClient();
      const expiresIn = hasExpiry
        ? expiryValue * (expiryUnit === "days" ? 86400 : 3600)
        : undefined;

      const result = await client.delegates.create({
        name: name.trim() || undefined,
        canUpload,
        canManageDepot,
        delegatedDepots:
          canManageDepot && selectedDepots.length > 0
            ? selectedDepots.map((d) => d.depotId)
            : undefined,
        scope: ["."], // inherit all
        tokenTtlSeconds: tokenTtl,
        expiresIn,
      });

      if (result.ok) {
        onCreated(result.data);
      } else {
        setError(result.error?.message ?? "Failed to create delegate");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Delegate</DialogTitle>
      <DialogContent>
        {/* Name */}
        <TextField
          label="Name"
          placeholder="e.g. CI/CD Pipeline, MCP Tool, Code Review Bot"
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 64 }}
          helperText="Optional. A human-readable label for this delegate."
          fullWidth
          sx={{ mt: 1 }}
        />

        {/* Permissions */}
        <FormGroup sx={{ mt: 2 }}>
          <FormControlLabel
            control={<Switch checked={canUpload} onChange={(_, v) => setCanUpload(v)} />}
            label="Can upload nodes"
          />
          <FormControlLabel
            control={
              <Switch
                checked={canManageDepot}
                onChange={(_, v) => {
                  setCanManageDepot(v);
                  if (!v) setSelectedDepots([]);
                }}
              />
            }
            label="Can manage depots"
          />
        </FormGroup>

        {/* Delegated Depots — only when canManageDepot */}
        {canManageDepot && (
          <Autocomplete
            multiple
            options={depots}
            getOptionLabel={(d) => d.title || d.depotId}
            value={selectedDepots}
            onChange={(_, v) => setSelectedDepots(v)}
            loading={depotsLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Delegated Depots"
                helperText="Leave empty to delegate all depots"
                slotProps={{
                  input: {
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {depotsLoading && <CircularProgress size={20} />}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((d, i) => (
                <Chip
                  label={d.title || d.depotId.slice(0, 12)}
                  {...getTagProps({ index: i })}
                  key={d.depotId}
                />
              ))
            }
            sx={{ mt: 2 }}
          />
        )}

        {/* Scope — simplified */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Scope: Inherits all parent scopes
        </Typography>

        {/* ── Delegate Lifetime ── */}
        <Typography variant="subtitle2" sx={{ mt: 3, mb: 0.5 }}>
          Delegate Lifetime
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          How long this delegate remains valid. After expiration, all access tokens under it
          become invalid regardless of their own TTL.
        </Typography>

        <FormControlLabel
          control={<Switch checked={hasExpiry} onChange={(_, v) => setHasExpiry(v)} />}
          label="Set expiration"
          sx={{ display: "block" }}
        />
        {hasExpiry && (
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            <TextField
              type="number"
              value={expiryValue}
              onChange={(e) => setExpiryValue(Number(e.target.value))}
              inputProps={{ min: 1 }}
              sx={{ width: 120 }}
            />
            <TextField
              select
              value={expiryUnit}
              onChange={(e) => setExpiryUnit(e.target.value as "hours" | "days")}
              sx={{ width: 120 }}
            >
              <MenuItem value="hours">Hours</MenuItem>
              <MenuItem value="days">Days</MenuItem>
            </TextField>
          </Box>
        )}
        {!hasExpiry && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
            No expiration — delegate remains valid until manually revoked.
          </Typography>
        )}

        {/* ── Access Token TTL ── */}
        <Typography variant="subtitle2" sx={{ mt: 3, mb: 0.5 }}>
          Access Token TTL
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Lifetime of each access token issued under this delegate. Must not exceed the delegate
          lifetime above.
        </Typography>

        <TextField
          select
          label="Token TTL"
          value={tokenTtl}
          onChange={(e) => setTokenTtl(Number(e.target.value))}
          error={ttlExceedsLifetime}
          helperText={
            ttlExceedsLifetime
              ? "Token TTL must not exceed delegate lifetime."
              : undefined
          }
          fullWidth
        >
          {TTL_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

        {/* Error */}
        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || ttlExceedsLifetime}>
          {submitting ? <CircularProgress size={20} /> : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
