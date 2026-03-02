import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useState } from "react";
import { useDelegatesStore } from "../../../stores/delegates-store";

type RevokeDelegateDialogProps = {
  open: boolean;
  onClose: () => void;
  delegate: { delegateId: string; name?: string };
  onRevoked: () => void;
};

export function RevokeDelegateDialog({
  open,
  onClose,
  delegate,
  onRevoked,
}: RevokeDelegateDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const revokeDelegate = useDelegatesStore((s) => s.revokeDelegate);

  const handleRevoke = async () => {
    setSubmitting(true);
    try {
      await revokeDelegate(delegate.delegateId);
      onRevoked();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const label = delegate.name || delegate.delegateId.slice(0, 16) + "…";

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Revoke Delegate</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Revoke access for &quot;{label}&quot;? This cannot be undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleRevoke} color="error" variant="contained" disabled={submitting}>
          Revoke
        </Button>
      </DialogActions>
    </Dialog>
  );
}
