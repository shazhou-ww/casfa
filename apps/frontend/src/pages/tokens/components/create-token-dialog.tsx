import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
} from "@mui/material";
import { useState } from "react";
import { useCreateToken } from "../../../hooks/use-tokens";

type CreateTokenDialogProps = {
  open: boolean;
  realm: string;
  onClose: () => void;
};

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
  { label: "90 days", value: 7776000 },
];

export function CreateTokenDialog({ open, realm, onClose }: CreateTokenDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"delegate" | "access">("delegate");
  const [expiresIn, setExpiresIn] = useState(604800);
  const [canUpload, setCanUpload] = useState(true);
  const [canManageDepot, setCanManageDepot] = useState(false);
  const [error, setError] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const createToken = useCreateToken();

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setError("");
    try {
      const result = await createToken.mutateAsync({
        realm,
        name: name.trim(),
        type,
        expiresIn,
        canUpload,
        canManageDepot,
      });
      setCreatedToken(result.tokenBase64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token");
    }
  };

  const handleClose = () => {
    setName("");
    setType("delegate");
    setExpiresIn(604800);
    setCanUpload(true);
    setCanManageDepot(false);
    setError("");
    setCreatedToken(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{createdToken ? "Token Created" : "Create Token"}</DialogTitle>
      <DialogContent
        sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}
      >
        {error && <Alert severity="error">{error}</Alert>}
        {createdToken ? (
          <Alert severity="success">
            Copy this token now. It will not be shown again.
            <TextField
              fullWidth
              value={createdToken}
              margin="dense"
              slotProps={{ input: { readOnly: true } }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </Alert>
        ) : (
          <>
            <TextField
              autoFocus
              label="Token name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <TextField
              select
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as "delegate" | "access")}
              fullWidth
            >
              <MenuItem value="delegate">Delegate</MenuItem>
              <MenuItem value="access">Access</MenuItem>
            </TextField>
            <TextField
              select
              label="Expires in"
              value={expiresIn}
              onChange={(e) => setExpiresIn(Number(e.target.value))}
              fullWidth
            >
              {TTL_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox checked={canUpload} onChange={(e) => setCanUpload(e.target.checked)} />
              }
              label="Can upload files"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={canManageDepot}
                  onChange={(e) => setCanManageDepot(e.target.checked)}
                />
              }
              label="Can manage depots"
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{createdToken ? "Close" : "Cancel"}</Button>
        {!createdToken && (
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!name.trim() || createToken.isPending}
          >
            Create
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
