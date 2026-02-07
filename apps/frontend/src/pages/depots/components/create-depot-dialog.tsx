import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useState } from "react";
import { useCreateDepot } from "../../../hooks/use-depots";

type CreateDepotDialogProps = {
  open: boolean;
  realm: string;
  onClose: () => void;
};

export function CreateDepotDialog({ open, realm, onClose }: CreateDepotDialogProps) {
  const [title, setTitle] = useState("");
  const [maxHistory, setMaxHistory] = useState("20");
  const [error, setError] = useState("");
  const createDepot = useCreateDepot(realm);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setError("");
    try {
      await createDepot.mutateAsync({
        title: title.trim(),
        maxHistory: Number.parseInt(maxHistory, 10) || 20,
      });
      setTitle("");
      setMaxHistory("20");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create depot");
    }
  };

  const handleClose = () => {
    setTitle("");
    setMaxHistory("20");
    setError("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Create Depot</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          fullWidth
          margin="dense"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <TextField
          label="Max history snapshots"
          value={maxHistory}
          onChange={(e) => setMaxHistory(e.target.value)}
          type="number"
          fullWidth
          margin="dense"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!title.trim() || createDepot.isPending}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
