/**
 * <ErrorSnackbar /> - Global error notification.
 *
 * Displays errors from the store using MUI Snackbar + Alert.
 * Auto-dismisses after 5 seconds.
 */

import { Alert, Snackbar } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ExplorerError, ExplorerErrorType } from "../types.ts";

type ErrorSnackbarProps = {
  onError?: (error: ExplorerError) => void;
};

const severityMap: Record<ExplorerErrorType, "error" | "warning" | "info"> = {
  network: "error",
  auth_expired: "warning",
  permission_denied: "warning",
  not_found: "warning",
  file_too_large: "warning",
  name_conflict: "warning",
  unknown: "error",
};

export function ErrorSnackbar({ onError }: ErrorSnackbarProps) {
  const t = useExplorerT();
  const lastError = useExplorerStore((s) => s.lastError);
  const setError = useExplorerStore((s) => s.setError);

  const [open, setOpen] = useState(false);
  const [displayError, setDisplayError] = useState<ExplorerError | null>(null);

  // Show snackbar when a new error arrives
  useEffect(() => {
    if (lastError) {
      setDisplayError(lastError);
      setOpen(true);
      onError?.(lastError);
    }
  }, [lastError, onError]);

  const handleClose = useCallback(
    (_event?: React.SyntheticEvent | Event, reason?: string) => {
      if (reason === "clickaway") return;
      setOpen(false);
      setError(null);
    },
    [setError]
  );

  const getErrorMessage = useCallback(
    (error: ExplorerError): string => {
      // Use the i18n key if available, fall back to the error message
      const keyMap: Record<ExplorerErrorType, string> = {
        network: t("error.network"),
        auth_expired: t("error.authExpired"),
        permission_denied: t("error.permissionDenied"),
        not_found: t("error.notFound"),
        file_too_large: t("error.fileTooLarge"),
        name_conflict: t("error.nameConflict"),
        unknown: t("error.unknown"),
      };
      return keyMap[error.type] || error.message;
    },
    [t]
  );

  if (!displayError) return null;

  return (
    <Snackbar
      open={open}
      autoHideDuration={5000}
      onClose={handleClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert
        onClose={handleClose}
        severity={severityMap[displayError.type]}
        variant="filled"
        sx={{ width: "100%" }}
      >
        {getErrorMessage(displayError)}
      </Alert>
    </Snackbar>
  );
}
