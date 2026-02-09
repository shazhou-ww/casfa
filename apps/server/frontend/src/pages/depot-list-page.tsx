/**
 * DepotListPage — manages depots (create, delete, navigate).
 *
 * This is the main landing page after login.
 * Shows all depots as cards. Click a depot to open the file browser.
 */

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import StorageIcon from "@mui/icons-material/Storage";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDepotStore } from "../stores/depot-store.ts";

export function DepotListPage() {
  const navigate = useNavigate();
  const { depots, loading, error, operating, createDepot, deleteDepot } =
    useDepotStore();

  // Create depot dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState<{
    depotId: string;
    title: string;
  } | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    const depot = await createDepot(newTitle.trim());
    if (depot) {
      setCreateOpen(false);
      setNewTitle("");
      setSnackbar({
        open: true,
        message: `Depot "${depot.title || depot.depotId}" created`,
        severity: "success",
      });
    } else {
      setSnackbar({
        open: true,
        message: "Failed to create depot",
        severity: "error",
      });
    }
  }, [newTitle, createDepot]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const ok = await deleteDepot(deleteTarget.depotId);
    if (ok) {
      setSnackbar({
        open: true,
        message: `Depot "${deleteTarget.title}" deleted`,
        severity: "success",
      });
    } else {
      setSnackbar({
        open: true,
        message: "Failed to delete depot",
        severity: "error",
      });
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteDepot]);

  const handleOpenDepot = (depotId: string) => {
    navigate(`/depot/${encodeURIComponent(depotId)}`);
  };

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100%"
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={3}
      >
        <Typography variant="h5" fontWeight={600}>
          My Depots
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ textTransform: "none" }}
        >
          New Depot
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Depot Cards Grid */}
      {depots.length === 0 ? (
        <Box textAlign="center" py={8}>
          <StorageIcon sx={{ fontSize: 64, color: "text.secondary", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No depots yet
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Create your first depot to start storing files.
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
            sx={{ textTransform: "none" }}
          >
            Create Depot
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 2,
          }}
        >
          {depots.map((depot) => (
            <Card key={depot.depotId} variant="outlined">
              <CardActionArea onClick={() => handleOpenDepot(depot.depotId)}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <FolderOpenIcon color="primary" />
                    <Typography variant="h6" noWrap>
                      {depot.title || depot.depotId}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    ID: {depot.depotId}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Root: {depot.root ? depot.root.slice(0, 20) + "…" : "empty"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Created:{" "}
                    {new Date(depot.createdAt).toLocaleDateString()}
                  </Typography>
                </CardContent>
              </CardActionArea>
              <CardActions>
                <Button
                  size="small"
                  onClick={() => handleOpenDepot(depot.depotId)}
                  sx={{ textTransform: "none" }}
                >
                  Open
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Delete depot">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({
                        depotId: depot.depotId,
                        title: depot.title || depot.depotId,
                      });
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      {/* Create Depot Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Depot</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            A depot is an independent storage space for your files. Give it a
            descriptive name.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="Depot Name"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            disabled={operating}
            placeholder="e.g. My Project, Research Data"
            inputProps={{ maxLength: 128 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={operating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={operating || !newTitle.trim()}
          >
            {operating ? <CircularProgress size={20} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
      >
        <DialogTitle>Delete Depot</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete depot "
            <strong>{deleteTarget?.title}</strong>"? This action cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={operating}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={operating}
          >
            {operating ? <CircularProgress size={20} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
