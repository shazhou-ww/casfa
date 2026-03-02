import { Alert, Box, Snackbar, Tab, Tabs, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreateDelegateDialog } from "../components/settings/delegates/create-delegate-dialog";
import { DelegatesTab } from "../components/settings/delegates-tab";
import { RevokeDelegateDialog } from "../components/settings/delegates/revoke-dialog";
import { TokenDisplay } from "../components/settings/delegates/token-display";
import type { CreateDelegateResponse, DelegateListItem } from "../types/delegate";
import { useDelegatesStore } from "../stores/delegates-store";

const DELEGATES_TAB = "delegates";

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
  const tabValue = pathPart === DELEGATES_TAB ? DELEGATES_TAB : DELEGATES_TAB;

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    delegateId: string;
    name?: string;
  } | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: "success" | "info" } | null>(null);

  const fetchDelegates = useDelegatesStore((s) => s.fetchDelegates);

  const handleTabChange = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      if (value === DELEGATES_TAB) {
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
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Settings
      </Typography>
      <Tabs value={tabValue} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab label="Delegates" value={DELEGATES_TAB} />
      </Tabs>
      {tabValue === DELEGATES_TAB && (
        <DelegatesTab
          onCreateClick={handleCreateClick}
          onRevokeClick={handleRevokeClick}
        />
      )}

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
