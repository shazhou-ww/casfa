/**
 * <DepotSelector /> - Displays available depots for selection,
 * with create and delete depot management features.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type DepotSelectorProps = {
  onSelect: (depotId: string) => void;
};

export function DepotSelector({ onSelect }: DepotSelectorProps) {
  const t = useExplorerT();
  const depots = useExplorerStore((s) => s.depots);
  const depotsLoading = useExplorerStore((s) => s.depotsLoading);
  const loadDepots = useExplorerStore((s) => s.loadDepots);
  const createDepot = useExplorerStore((s) => s.createDepot);
  const deleteDepot = useExplorerStore((s) => s.deleteDepot);
  const permissions = useExplorerStore((s) => s.permissions);

  const [search, setSearch] = useState("");

  // ── Create depot dialog ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // ── Delete depot dialog ──
  const [deleteTarget, setDeleteTarget] = useState<{ depotId: string; title: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadDepots();
  }, [loadDepots]);

  const filtered = search
    ? depots.filter(
        (d) =>
          d.depotId.toLowerCase().includes(search.toLowerCase()) ||
          (d.title && d.title.toLowerCase().includes(search.toLowerCase())),
      )
    : depots;

  // ── Create handlers ──
  const handleCreateOpen = useCallback(() => {
    setCreateTitle("");
    setCreateOpen(true);
  }, []);

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
    setCreateTitle("");
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    setCreating(true);
    const depotId = await createDepot(createTitle.trim() || undefined);
    setCreating(false);
    if (depotId) {
      handleCreateClose();
      // Automatically select the newly created depot
      onSelect(depotId);
    }
  }, [createDepot, createTitle, handleCreateClose, onSelect]);

  const handleCreateKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCreateSubmit();
      }
    },
    [handleCreateSubmit],
  );

  // ── Delete handlers ──
  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, depotId: string, title: string | null) => {
      e.stopPropagation();
      setDeleteTarget({ depotId, title });
    },
    [],
  );

  const handleDeleteClose = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await deleteDepot(deleteTarget.depotId);
    setDeleting(false);
    setDeleteTarget(null);
  }, [deleteDepot, deleteTarget]);

  return (
    <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
      {/* Header row: title + create button */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h6">
          {t("depot.title")}
        </Typography>
        {permissions.canManageDepot && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleCreateOpen}
          >
            {t("depot.create")}
          </Button>
        )}
      </Box>

      <TextField
        size="small"
        fullWidth
        placeholder={t("depot.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2 }}
      />

      {depotsLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {!depotsLoading && filtered.length === 0 && (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("depot.empty")}
          </Typography>
          {permissions.canManageDepot && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateOpen}>
              {t("depot.create")}
            </Button>
          )}
        </Box>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {filtered.map((depot) => (
          <Card key={depot.depotId} variant="outlined">
            <CardContent
              sx={{
                py: 1.5,
                px: 2,
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
                "&:last-child": { pb: 1.5 },
              }}
              onClick={() => onSelect(depot.depotId)}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap>
                  {depot.title || depot.depotId}
                </Typography>
                {depot.title && (
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {depot.depotId}
                  </Typography>
                )}
              </Box>
              {permissions.canManageDepot && (
                <Tooltip title={t("depot.delete")}>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(e) => handleDeleteClick(e, depot.depotId, depot.title)}
                    sx={{ ml: 1, opacity: 0.5, "&:hover": { opacity: 1 } }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* ── Create Depot Dialog ── */}
      <Dialog open={createOpen} onClose={handleCreateClose} maxWidth="xs" fullWidth>
        <DialogTitle>{t("depot.createTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t("depot.createLabel")}
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            disabled={creating}
            placeholder={t("depot.untitled")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateClose} disabled={creating}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={handleCreateSubmit} variant="contained" disabled={creating}>
            {creating ? <CircularProgress size={20} /> : t("dialog.confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Depot Dialog ── */}
      <Dialog open={!!deleteTarget} onClose={handleDeleteClose} maxWidth="xs" fullWidth>
        <DialogTitle>{t("depot.delete")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("depot.deleteConfirm", {
              name: deleteTarget?.title || deleteTarget?.depotId || "",
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteClose} disabled={deleting}>
            {t("dialog.cancel")}
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={20} /> : t("dialog.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
