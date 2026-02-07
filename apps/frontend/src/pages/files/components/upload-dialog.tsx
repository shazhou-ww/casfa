import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { useRef, useState } from "react";
import { useFileMutations } from "../../../hooks/use-file-mutations";
import { useFileBrowserStore } from "../../../stores/file-browser-store";

type UploadDialogProps = {
  open: boolean;
  onClose: () => void;
  realm: string | null;
};

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB CAS single-block limit

export function UploadDialog({ open, onClose, realm }: UploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const { currentPath, currentDepotId } = useFileBrowserStore();
  const ctx = realm && currentDepotId ? { realm, depotId: currentDepotId } : null;
  const { write } = useFileMutations(realm, ctx);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setError(`Files over 4MB are not supported: ${oversized.map((f) => f.name).join(", ")}`);
    }
    setFiles(selected.filter((f) => f.size <= MAX_FILE_SIZE));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const data = new Uint8Array(await file.arrayBuffer());
        const path = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
        const contentType = file.type || "application/octet-stream";
        await write.mutateAsync({ path, data, contentType });
        setProgress(((i + 1) / files.length) * 100);
      }
      setFiles([]);
      setProgress(0);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setProgress(0);
      setError("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Upload Files</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <input ref={inputRef} type="file" multiple hidden onChange={handleSelect} />
        <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={uploading}>
          Select Files
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          Max 4MB per file
        </Typography>
        {files.length > 0 && (
          <List dense>
            {files.map((f) => (
              <ListItem key={f.name}>
                <ListItemText primary={f.name} secondary={`${(f.size / 1024).toFixed(1)} KB`} />
              </ListItem>
            ))}
          </List>
        )}
        {uploading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>
          Cancel
        </Button>
        <Button
          onClick={handleUpload}
          variant="contained"
          disabled={files.length === 0 || uploading}
        >
          Upload {files.length > 0 ? `(${files.length})` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
