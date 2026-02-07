import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useFileMutations } from "../../../hooks/use-file-mutations";
import { useFileBrowserStore } from "../../../stores/file-browser-store";

type RenameDialogProps = {
  open: boolean;
  currentName: string;
  onClose: () => void;
  realm: string | null;
};

export function RenameDialog({ open, currentName, onClose, realm }: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState("");
  const { currentPath, currentDepotId } = useFileBrowserStore();
  const ctx = realm && currentDepotId ? { realm, depotId: currentDepotId } : null;
  const { mv } = useFileMutations(realm, ctx);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setError("");
    }
  }, [open, currentName]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    if (trimmed.includes("/")) {
      setError("Name cannot contain '/'");
      return;
    }
    try {
      const from = currentPath === "/" ? `/${currentName}` : `${currentPath}/${currentName}`;
      const to = currentPath === "/" ? `/${trimmed}` : `${currentPath}/${trimmed}`;
      await mv.mutateAsync({ from, to });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          label="New name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          margin="dense"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!name.trim() || name.trim() === currentName || mv.isPending}
        >
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}
