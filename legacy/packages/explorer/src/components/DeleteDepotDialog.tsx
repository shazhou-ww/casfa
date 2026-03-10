/**
 * <DeleteDepotDialog /> - Confirmation dialog for deleting a depot.
 * Extracted from DepotSelector for use in the tree sidebar.
 */

import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type DeleteDepotDialogProps = {
  open: boolean;
  depotId: string | null;
  depotName: string | null;
  onClose: () => void;
};

export function DeleteDepotDialog({ open, depotId, depotName, onClose }: DeleteDepotDialogProps) {
  const t = useExplorerT();
  const deleteDepot = useExplorerStore((s) => s.deleteDepot);

  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!depotId) return;
    setDeleting(true);
    await deleteDepot(depotId);
    setDeleting(false);
    onClose();
  }, [deleteDepot, depotId, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("depot.delete")}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t("depot.deleteConfirm", { name: depotName || depotId || "" })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          {t("dialog.cancel")}
        </Button>
        <Button onClick={handleConfirm} color="error" variant="contained" disabled={deleting}>
          {deleting ? <CircularProgress size={20} /> : t("dialog.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
