import KeyIcon from "@mui/icons-material/Key";
import StorageIcon from "@mui/icons-material/Storage";
import { Alert, Box, List, ListItemButton, ListItemIcon, ListItemText, Snackbar, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreateDelegateDialog } from "../components/settings/delegates/create-delegate-dialog";
import { DelegatesTab } from "../components/settings/delegates-tab";
import { RevokeDelegateDialog } from "../components/settings/delegates/revoke-dialog";
import { StorageTab } from "../components/settings/storage-tab";
import { TokenDisplay } from "../components/settings/delegates/token-display";
import type { CreateDelegateResponse, DelegateListItem } from "../types/delegate";
import { useDelegatesStore } from "../stores/delegates-store";

const DELEGATES_TAB = "delegates";
const STORAGE_TAB = "storage";

const SIDEBAR_WIDTH = 220;

type TokenData = {
  delegateId: string;
  name?: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathPart = location.pathname.replace(/^\/settings\/?/, "") || DELEGATES_TAB;
  const tabValue =
    pathPart === "storage" ? STORAGE_TAB : pathPart === "delegates" || pathPart === "" ? DELEGATES_TAB : DELEGATES_TAB;

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    delegateId: string;
    name?: string;
  } | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: "success" | "info" } | null>(null);

  const fetchDelegates = useDelegatesStore((s) => s.fetchDelegates);

  const handleNav = useCallback(
    (value: string) => {
      if (value === STORAGE_TAB) {
        navigate("/settings/storage", { replace: true });
      } else if (value === DELEGATES_TAB) {
        navigate("/settings/delegates", { replace: true });
      }
    },
    [navigate]
  );

  const handleCreateClick = useCallback(() => setCreateOpen(true), []);
  const handleCloseCreate = useCallback(() => setCreateOpen(false), []);

  const handleCreated = useCallback(
    (response: CreateDelegateResponse) => {
      setCreateOpen(false);
      setTokenData({
        delegateId: response.delegate.delegateId,
        name: response.delegate.name ?? undefined,
        accessToken: response.accessToken,
        accessTokenExpiresAt: response.accessTokenExpiresAt,
      });
      fetchDelegates();
      setSnackbar({ message: "Delegate created successfully", severity: "success" });
    },
    [fetchDelegates]
  );

  const handleCloseToken = useCallback(() => setTokenData(null), []);

  const handleRevokeClick = useCallback((delegate: DelegateListItem) => {
    setRevokeTarget({
      delegateId: delegate.delegateId,
      name: delegate.name ?? undefined,
    });
  }, []);

  const handleCloseRevoke = useCallback(() => setRevokeTarget(null), []);

  const handleRevoked = useCallback(() => {
    fetchDelegates();
    setSnackbar({ message: "Delegate revoked", severity: "success" });
  }, [fetchDelegates]);

  return (
    <Box sx={{ height: "100%", display: "flex", overflow: "hidden" }}>
      {/* Left sidebar */}
      <Box
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Typography variant="subtitle1" sx={{ px: 2, py: 2, fontWeight: 600 }}>
          Settings
        </Typography>
        <List dense disablePadding sx={{ px: 1 }}>
          <ListItemButton
            selected={tabValue === DELEGATES_TAB}
            onClick={() => handleNav(DELEGATES_TAB)}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <KeyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Delegates" primaryTypographyProps={{ variant: "body2" }} />
          </ListItemButton>
          <ListItemButton
            selected={tabValue === STORAGE_TAB}
            onClick={() => handleNav(STORAGE_TAB)}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <StorageIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="存储" primaryTypographyProps={{ variant: "body2" }} />
          </ListItemButton>
        </List>
      </Box>
      {/* Right content */}
      <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <Box sx={{ flex: 1, p: 3, pt: 2, overflow: "auto" }}>
          {tabValue === STORAGE_TAB && <StorageTab />}
          {tabValue === DELEGATES_TAB && (
            <DelegatesTab
              onCreateClick={handleCreateClick}
              onRevokeClick={handleRevokeClick}
            />
          )}
        </Box>
      </Box>

      <CreateDelegateDialog
        open={createOpen}
        onClose={handleCloseCreate}
        onCreated={handleCreated}
      />

      {tokenData && (
        <TokenDisplay
          open={!!tokenData}
          onClose={handleCloseToken}
          data={tokenData}
        />
      )}

      {revokeTarget && (
        <RevokeDelegateDialog
          open={!!revokeTarget}
          onClose={handleCloseRevoke}
          delegate={revokeTarget}
          onRevoked={handleRevoked}
        />
      )}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snackbar ? (
          <Alert
            onClose={() => setSnackbar(null)}
            severity={snackbar.severity}
            variant="filled"
            sx={{ width: "100%" }}
          >
            {snackbar.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
