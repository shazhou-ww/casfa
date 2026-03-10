/**
 * RevokeDelegateDialog — confirmation dialog for revoking a delegate.
 *
 * Shows delegate info, cascade warning, and executes the revoke API call.
 */

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { getAppClient } from "../../lib/client.ts";

// ============================================================================
// Types
// ============================================================================

type RevokeDelegateDialogProps = {
  open: boolean;
  onClose: () => void;
  delegate: {
    delegateId: string;
    name?: string;
    depth: number;
  };
  onRevoked: () => void;
};

// ============================================================================
// Component
// ============================================================================

export function RevokeDelegateDialog({
  open,
  onClose,
  delegate,
  onRevoked,
}: RevokeDelegateDialogProps) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = useCallback(async () => {
    setRevoking(true);
    setError(null);
    try {
      const client = await getAppClient();
      const result = await client.delegates.revoke(delegate.delegateId);
      if (result.ok) {
        onRevoked();
        onClose();
      } else {
        setError(result.error?.message ?? "Failed to revoke delegate");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRevoking(false);
    }
  }, [delegate.delegateId, onRevoked, onClose]);

  const handleClose = useCallback(() => {
    if (!revoking) {
      setError(null);
      onClose();
    }
  }, [revoking, onClose]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Revoke Delegate</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Warning</AlertTitle>
          Revoking this delegate will <strong>permanently invalidate</strong> it along with all its
          descendant delegates. This action cannot be undone.
        </Alert>

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Delegate
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {delegate.name || "Unnamed"}
          </Typography>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            ID
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.85em" }}>
            {delegate.delegateId}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={revoking}>
          Cancel
        </Button>
        <Button
          onClick={handleRevoke}
          color="error"
          variant="contained"
          disabled={revoking}
          startIcon={revoking ? <CircularProgress size={16} /> : undefined}
        >
          {revoking ? "Revoking…" : "Revoke"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
