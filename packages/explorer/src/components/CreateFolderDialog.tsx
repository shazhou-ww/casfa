/**
 * <CreateFolderDialog /> - Dialog for creating a new folder.
 *
 * Validates folder name: non-empty, no `/` or `\0`, not a duplicate.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type CreateFolderDialogProps = {
  open: boolean;
  onClose: () => void;
};

/** Characters not allowed in file/folder names */
const INVALID_CHARS = /[/\0]/;

export function CreateFolderDialog({ open, onClose }: CreateFolderDialogProps) {
  const t = useExplorerT();
  const items = useExplorerStore((s) => s.items);
  const createFolder = useExplorerStore((s) => s.createFolder);
  const operationLoading = useExplorerStore((s) => s.operationLoading);

  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const existingNames = useMemo(
    () => new Set(items.map((item) => item.name.toLowerCase())),
    [items],
  );

  const validationError = useMemo(() => {
    if (!name.trim()) return t("validation.nameEmpty");
    if (INVALID_CHARS.test(name)) return t("validation.nameInvalid");
    if (existingNames.has(name.trim().toLowerCase())) return t("validation.nameExists");
    return null;
  }, [name, existingNames, t]);

  const handleClose = useCallback(() => {
    setName("");
    setSubmitted(false);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (validationError) return;

    const success = await createFolder(name.trim());
    if (success) {
      handleClose();
    }
  }, [createFolder, name, validationError, handleClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isLoading = operationLoading.createFolder ?? false;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("dialog.newFolder.title")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={t("dialog.newFolder.label")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          error={submitted && !!validationError}
          helperText={submitted ? validationError : undefined}
          disabled={isLoading}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t("dialog.cancel")}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isLoading || (submitted && !!validationError)}
        >
          {t("dialog.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
