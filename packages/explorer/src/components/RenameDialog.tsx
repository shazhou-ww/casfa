/**
 * <RenameDialog /> - Dialog for renaming a file or folder.
 *
 * Pre-fills with the current name and validates the new name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ExplorerItem } from "../types.ts";

type RenameDialogProps = {
  open: boolean;
  item: ExplorerItem | undefined;
  onClose: () => void;
};

/** Characters not allowed in file/folder names */
const INVALID_CHARS = /[/\0]/;

export function RenameDialog({ open, item, onClose }: RenameDialogProps) {
  const t = useExplorerT();
  const items = useExplorerStore((s) => s.items);
  const renameItem = useExplorerStore((s) => s.renameItem);
  const operationLoading = useExplorerStore((s) => s.operationLoading);

  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Pre-fill with current name when dialog opens
  useEffect(() => {
    if (open && item) {
      setName(item.name);
      setSubmitted(false);
    }
  }, [open, item]);

  const existingNames = useMemo(
    () =>
      new Set(
        items
          .filter((i) => i.name !== item?.name)
          .map((i) => i.name.toLowerCase()),
      ),
    [items, item],
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
    if (validationError || !item) return;

    const trimmedName = name.trim();
    if (trimmedName === item.name) {
      handleClose();
      return;
    }

    const success = await renameItem(item, trimmedName);
    if (success) {
      handleClose();
    }
  }, [renameItem, item, name, validationError, handleClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isLoading = operationLoading.rename ?? false;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("dialog.rename.title")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={t("dialog.rename.label")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          error={submitted && !!validationError}
          helperText={submitted ? validationError : undefined}
          disabled={isLoading}
          onFocus={(e) => {
            // Select filename without extension
            const dotIdx = name.lastIndexOf(".");
            if (dotIdx > 0 && !item?.isDirectory) {
              e.target.setSelectionRange(0, dotIdx);
            } else {
              e.target.select();
            }
          }}
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
