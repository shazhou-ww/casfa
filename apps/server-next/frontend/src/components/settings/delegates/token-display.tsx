import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";

type TokenData = {
  delegateId: string;
  name?: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

type TokenDisplayProps = {
  open: boolean;
  onClose: () => void;
  data: TokenData;
};

function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

export function TokenDisplay({ open, onClose, data }: TokenDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(data.accessToken);
    setCopied(true);
  }, [data.accessToken]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delegate token</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Copy this token and store it securely. It won&apos;t be shown again.
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            p: 1,
            bgcolor: "action.hover",
            borderRadius: 1,
            fontFamily: "monospace",
            fontSize: "0.75rem",
            wordBreak: "break-all",
          }}
        >
          <Box component="span" sx={{ flex: 1 }}>
            {data.accessToken}
          </Box>
          <IconButton size="small" onClick={handleCopy} aria-label="Copy token">
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Box>
        {copied && (
          <Typography variant="caption" color="success.main" sx={{ mt: 0.5 }}>
            Copied to clipboard
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Expires: {formatTime(data.accessTokenExpiresAt)}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
