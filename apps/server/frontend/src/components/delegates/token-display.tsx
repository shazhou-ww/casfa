/**
 * TokenDisplay — one-time display dialog for delegate tokens after creation.
 *
 * Shows a warning that tokens cannot be retrieved again,
 * provides copy buttons, and requires a double-close confirmation.
 */

import { Check as CheckIcon, ContentCopy as ContentCopyIcon } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

// ============================================================================
// Types
// ============================================================================

type TokenDisplayProps = {
  open: boolean;
  onClose: () => void;
  data: {
    delegateId: string;
    name?: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
  };
};

// ============================================================================
// Helpers
// ============================================================================

function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

// ============================================================================
// Component
// ============================================================================

export function TokenDisplay({ open, onClose, data }: TokenDisplayProps) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [rtCopied, setRtCopied] = useState(false);
  const [atCopied, setAtCopied] = useState(false);

  const handleClose = () => {
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    // Reset state and close
    setConfirmClose(false);
    setRtCopied(false);
    setAtCopied(false);
    onClose();
  };

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delegate Created Successfully</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Save these tokens now. They cannot be retrieved again after closing this dialog.
        </Alert>

        {data.name && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Delegate: <strong>{data.name}</strong> ({data.delegateId.slice(0, 16)}…)
          </Typography>
        )}

        {/* Refresh Token */}
        <Typography variant="subtitle2" gutterBottom>
          Refresh Token
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <TextField
            value={data.refreshToken}
            fullWidth
            size="small"
            slotProps={{
              input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: "0.85em" } },
            }}
          />
          <IconButton onClick={() => copyToClipboard(data.refreshToken, setRtCopied)}>
            {rtCopied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
          </IconButton>
        </Box>

        {/* Access Token */}
        <Typography variant="subtitle2" gutterBottom>
          Access Token
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <TextField
            value={data.accessToken}
            fullWidth
            size="small"
            slotProps={{
              input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: "0.85em" } },
            }}
          />
          <IconButton onClick={() => copyToClipboard(data.accessToken, setAtCopied)}>
            {atCopied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
          </IconButton>
        </Box>

        <Typography variant="body2" color="text.secondary">
          AT expires: {formatTime(data.accessTokenExpiresAt)}
        </Typography>

        {confirmClose && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Are you sure? Click close again to confirm you have saved the tokens.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color={confirmClose ? "error" : "primary"}>
          {confirmClose ? "Confirm Close" : "Close"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
