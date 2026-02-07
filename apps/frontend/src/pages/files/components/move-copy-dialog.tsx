import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useState } from "react";
import { useFileMutations } from "../../../hooks/use-file-mutations";
import { useFileBrowserStore } from "../../../stores/file-browser-store";
import { DirectoryTreePicker } from "./directory-tree-picker";

type MoveCopyDialogProps = {
  open: boolean;
  mode: "move" | "copy";
  itemName: string;
  onClose: () => void;
  realm: string | null;
};

export function MoveCopyDialog({ open, mode, itemName, onClose, realm }: MoveCopyDialogProps) {
  const [destination, setDestination] = useState("/");
  const [error, setError] = useState("");
  const { currentPath, currentDepotId, currentRoot } = useFileBrowserStore();
  const ctx = realm && currentDepotId ? { realm, depotId: currentDepotId } : null;
  const { mv, cp } = useFileMutations(realm, ctx);

  const handleSubmit = async () => {
    setError("");
    try {
      const from = currentPath === "/" ? `/${itemName}` : `${currentPath}/${itemName}`;
      const to = destination === "/" ? `/${itemName}` : `${destination}/${itemName}`;
      if (from === to) {
        setError("Source and destination are the same");
        return;
      }
      if (mode === "move") {
        await mv.mutateAsync({ from, to });
      } else {
        await cp.mutateAsync({ from, to });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${mode === "move" ? "Move" : "Copy"} failed`);
    }
  };

  const isPending = mode === "move" ? mv.isPending : cp.isPending;
  const title = mode === "move" ? `Move "${itemName}"` : `Copy "${itemName}"`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {realm && currentRoot && (
          <DirectoryTreePicker
            realm={realm}
            root={currentRoot}
            selected={destination}
            onSelect={setDestination}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isPending}>
          {mode === "move" ? "Move" : "Copy"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
