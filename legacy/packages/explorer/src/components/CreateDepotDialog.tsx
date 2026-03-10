/**
 * <CreateDepotDialog /> - Dialog for creating a new depot.
 * Extracted from DepotSelector for use in the tree sidebar.
 */

import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type CreateDepotDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Called after a depot is successfully created */
  onCreated?: (depotId: string) => void;
};

export function CreateDepotDialog({ open, onClose, onCreated }: CreateDepotDialogProps) {
  const t = useExplorerT();
  const createDepot = useExplorerStore((s) => s.createDepot);

  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleClose = useCallback(() => {
    setTitle("");
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    setCreating(true);
    const depotId = await createDepot(title.trim() || undefined);
    setCreating(false);
    if (depotId) {
      setTitle("");
      onCreated?.(depotId);
      onClose();
    }
  }, [createDepot, title, onCreated, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("depot.createTitle")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={t("depot.createLabel")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={creating}
          placeholder={t("depot.untitled")}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={creating}>
          {t("dialog.cancel")}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={creating}>
          {creating ? <CircularProgress size={20} /> : t("dialog.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
