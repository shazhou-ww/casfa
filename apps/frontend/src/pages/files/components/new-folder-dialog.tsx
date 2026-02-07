import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useState } from "react";
import { useFileMutations } from "../../../hooks/use-file-mutations";
import { useFileBrowserStore } from "../../../stores/file-browser-store";

type NewFolderDialogProps = {
  open: boolean;
  onClose: () => void;
  realm: string | null;
};

export function NewFolderDialog({ open, onClose, realm }: NewFolderDialogProps) {
  const [name, setName] = useState("");
  const { currentPath, currentDepotId } = useFileBrowserStore();
  const ctx = realm && currentDepotId ? { realm, depotId: currentDepotId } : null;
  const { mkdir } = useFileMutations(realm, ctx);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    await mkdir.mutateAsync(path);
    setName("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Folder</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label="Folder name"
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
          disabled={!name.trim() || mkdir.isPending}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
