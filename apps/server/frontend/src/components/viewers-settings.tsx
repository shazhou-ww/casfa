/**
 * ViewersSettings — tab content for managing viewers inside SettingsDialog.
 *
 * Shows built-in viewers (read-only) and custom viewers with CRUD operations.
 */

import type { AddCustomViewerInput, ViewerInfo } from "@casfa/client-bridge";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { getAppClient } from "../lib/client.ts";

// ============================================================================
// Add viewer dialog
// ============================================================================

function AddViewerDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (input: AddCustomViewerInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodeKey, setNodeKey] = useState("");
  const [contentTypes, setContentTypes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !nodeKey.trim()) {
      setError("Name and Node Key are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const types = contentTypes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await onAdd({
        name: name.trim(),
        description: description.trim() || undefined,
        nodeKey: nodeKey.trim(),
        contentTypes: types,
      });
      // Reset form
      setName("");
      setDescription("");
      setNodeKey("");
      setContentTypes("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add viewer.");
    } finally {
      setSaving(false);
    }
  }, [name, description, nodeKey, contentTypes, onAdd, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Custom Viewer</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            fullWidth
            required
            size="small"
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Node Key"
            value={nodeKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodeKey(e.target.value)}
            fullWidth
            required
            size="small"
            placeholder="nod_XXXXXXXXXXXXXXXXXXXXXXXXXX"
            helperText="The CAS node key of the viewer DAG."
          />
          <TextField
            label="Content Types"
            value={contentTypes}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContentTypes(e.target.value)}
            fullWidth
            size="small"
            placeholder="image/*, text/html"
            helperText="Comma-separated MIME patterns this viewer supports."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? <CircularProgress size={20} /> : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function ViewersSettings() {
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadViewers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await getAppClient();
      const all = await client.viewers.listAll();
      setViewers(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load viewers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadViewers();
  }, [loadViewers]);

  const handleAdd = useCallback(
    async (input: AddCustomViewerInput) => {
      const client = await getAppClient();
      await client.viewers.addCustom(input);
      await loadViewers();
    },
    [loadViewers]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      const client = await getAppClient();
      await client.viewers.removeCustom(id);
      await loadViewers();
    },
    [loadViewers]
  );

  const builtinViewers = viewers.filter((v) => v.isBuiltin);
  const customViewers = viewers.filter((v) => !v.isBuiltin);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Built-in viewers */}
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Built-in Viewers
      </Typography>
      <Stack spacing={1} sx={{ mb: 3 }}>
        {builtinViewers.map((v) => (
          <ViewerCard key={v.id} viewer={v} />
        ))}
        {builtinViewers.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ pl: 1 }}>
            No built-in viewers available.
          </Typography>
        )}
      </Stack>

      <Divider sx={{ mb: 2 }} />

      {/* Custom viewers */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="subtitle2" color="text.secondary">
          Custom Viewers
        </Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          variant="outlined"
        >
          Add
        </Button>
      </Box>
      <Stack spacing={1}>
        {customViewers.map((v) => (
          <ViewerCard key={v.id} viewer={v} onRemove={handleRemove} />
        ))}
        {customViewers.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ pl: 1 }}>
            No custom viewers added yet.
          </Typography>
        )}
      </Stack>

      <AddViewerDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
    </Box>
  );
}

// ============================================================================
// Viewer card
// ============================================================================

function ViewerCard({
  viewer,
  onRemove,
}: {
  viewer: ViewerInfo;
  onRemove?: (id: string) => void;
}) {
  // Build icon URL from viewer's icon path (if specified)
  const iconUrl = viewer.icon
    ? `/page/${encodeURIComponent(viewer.nodeKey)}/${encodeURIComponent(viewer.icon)}`
    : null;

  return (
    <Card variant="outlined" sx={{ px: 2, py: 1.5 }}>
      <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          {iconUrl ? (
            <Avatar
              src={iconUrl}
              variant="rounded"
              sx={{ width: 32, height: 32 }}
            />
          ) : (
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: viewer.isBuiltin ? "primary.main" : "info.main",
              }}
            >
              {viewer.isBuiltin ? (
                <VisibilityIcon sx={{ fontSize: 18 }} />
              ) : (
                <OpenInBrowserIcon sx={{ fontSize: 18 }} />
              )}
            </Avatar>
          )}
          <Box flex={1} minWidth={0}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {viewer.name}
            </Typography>
            {viewer.description && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {viewer.description}
              </Typography>
            )}
            {viewer.contentTypes.length > 0 && (
              <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
                {viewer.contentTypes.map((ct) => (
                  <Chip key={ct} label={ct} size="small" variant="outlined" />
                ))}
              </Box>
            )}
          </Box>
          {!viewer.isBuiltin && (
            <Tooltip title="Node key">
              <Typography
                variant="caption"
                sx={{ fontFamily: "monospace", color: "text.secondary", mr: 1 }}
              >
                {viewer.nodeKey.slice(0, 12)}…
              </Typography>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip title="Remove viewer">
              <IconButton size="small" onClick={() => onRemove(viewer.id)} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
