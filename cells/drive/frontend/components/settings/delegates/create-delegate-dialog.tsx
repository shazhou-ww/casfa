import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useDelegatesStore } from "../../../stores/delegates-store";
import type { CreateDelegateResponse } from "../../../types/delegate";

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
];

type CreateDelegateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (response: CreateDelegateResponse) => void;
};

export function CreateDelegateDialog({ open, onClose, onCreated }: CreateDelegateDialogProps) {
  const [name, setName] = useState("");
  const [tokenTtl, setTokenTtl] = useState(86400);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createDelegate = useDelegatesStore((s) => s.createDelegate);

  const handleClose = () => {
    if (!submitting) {
      setName("");
      setTokenTtl(86400);
      setError(null);
      onClose();
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await createDelegate({
        name: name.trim() || undefined,
        ttlSeconds: tokenTtl,
      });
      onCreated(response);
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create delegate");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Delegate</DialogTitle>
      <DialogContent>
        <TextField
          label="Name"
          placeholder="e.g. CI/CD, MCP Tool"
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 64 }}
          helperText="Optional. A human-readable label."
          fullWidth
          sx={{ mt: 1 }}
        />
        <TextField
          select
          label="Token TTL"
          value={tokenTtl}
          onChange={(e) => setTokenTtl(Number(e.target.value))}
          fullWidth
          sx={{ mt: 2 }}
        >
          {TTL_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
