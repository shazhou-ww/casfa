/**
 * <ConflictDialog /> - Name conflict resolution dialog.
 * (Iter 4)
 *
 * Shown when paste/upload encounters an existing item at the target path.
 * Options: overwrite, skip, rename (auto-suffix).
 */

import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ConflictAction, ConflictInfo, ConflictResolution } from "../types.ts";
import { formatSize } from "../utils/format-size.ts";

type ConflictDialogProps = {
  open: boolean;
  conflict: ConflictInfo | null;
  onResolve: (resolution: ConflictResolution) => void;
  onCancel: () => void;
};

export function ConflictDialog({ open, conflict, onResolve, onCancel }: ConflictDialogProps) {
  const t = useExplorerT();
  const [action, setAction] = useState<ConflictAction>("overwrite");
  const [applyToAll, setApplyToAll] = useState(false);

  const handleResolve = useCallback(() => {
    onResolve({ action, applyToAll });
  }, [action, applyToAll, onResolve]);

  if (!conflict) return null;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{t("conflict.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t("conflict.message", { name: conflict.source.name })}
        </Typography>

        {/* Source vs existing comparison */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            mb: 2,
            p: 1.5,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {t("conflict.source")}
            </Typography>
            <Typography variant="body2" noWrap>
              {conflict.source.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatSize(conflict.source.size)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {t("conflict.existing")}
            </Typography>
            <Typography variant="body2" noWrap>
              {conflict.existing.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatSize(conflict.existing.size)}
            </Typography>
          </Box>
        </Box>

        <RadioGroup value={action} onChange={(_, v) => setAction(v as ConflictAction)}>
          <FormControlLabel
            value="overwrite"
            control={<Radio size="small" />}
            label={t("conflict.overwrite")}
          />
          <FormControlLabel
            value="skip"
            control={<Radio size="small" />}
            label={t("conflict.skip")}
          />
          <FormControlLabel
            value="rename"
            control={<Radio size="small" />}
            label={t("conflict.rename")}
          />
        </RadioGroup>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={applyToAll}
              onChange={(_, checked) => setApplyToAll(checked)}
            />
          }
          label={t("conflict.applyToAll")}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("dialog.cancel")}</Button>
        <Button onClick={handleResolve} variant="contained">
          {t("dialog.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
