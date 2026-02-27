import type { CreateDelegateResponse, DelegateListItem } from "@casfa/protocol";
import type { AlertColor } from "@mui/material";
import { Alert, Box, Snackbar } from "@mui/material";
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { CreateDelegateDialog } from "../components/delegates/create-delegate-dialog.tsx";
import { DelegateDetail } from "../components/delegates/delegate-detail/index.ts";
import { DelegateList } from "../components/delegates/delegate-list.tsx";
import { RevokeDelegateDialog } from "../components/delegates/revoke-dialog.tsx";
import { TokenDisplay } from "../components/delegates/token-display.tsx";
import { useDelegatesStore } from "../stores/delegates-store.ts";

type TokenData = {
  delegateId: string;
  name?: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

type RevokeTarget = {
  delegateId: string;
  name?: string;
  depth: number;
};

export function DelegatesPage() {
  const { delegateId } = useParams();
  const fetchDelegates = useDelegatesStore((s) => s.fetchDelegates);

  const [createOpen, setCreateOpen] = useState(false);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: AlertColor } | null>(null);

  const handleNotify = useCallback((message: string, severity: AlertColor = "info") => {
    setSnackbar({ message, severity });
  }, []);

  const handleOpenCreate = useCallback(() => setCreateOpen(true), []);
  const handleCloseCreate = useCallback(() => setCreateOpen(false), []);

  const handleCreated = useCallback(
    (response: CreateDelegateResponse) => {
      setCreateOpen(false);
      setTokenData({
        delegateId: response.delegate.delegateId,
        name: response.delegate.name ?? undefined,
        refreshToken: response.refreshToken,
        accessToken: response.accessToken,
        accessTokenExpiresAt: response.accessTokenExpiresAt,
      });
      fetchDelegates();
      setSnackbar({ message: "Delegate created successfully", severity: "success" });
    },
    [fetchDelegates]
  );

  const handleCloseToken = useCallback(() => setTokenData(null), []);

  // Revoke from detail page: we only have delegateId, depth is unknown
  const handleDetailRevokeClick = useCallback(() => {
    if (delegateId) {
      setRevokeTarget({ delegateId, depth: 0 });
    }
  }, [delegateId]);

  // Revoke from list page: we have the full DelegateListItem
  const handleListRevokeClick = useCallback((delegate: DelegateListItem) => {
    setRevokeTarget({
      delegateId: delegate.delegateId,
      name: delegate.name ?? undefined,
      depth: delegate.depth,
    });
  }, []);

  const handleCloseRevoke = useCallback(() => setRevokeTarget(null), []);

  const handleRevoked = useCallback(() => {
    fetchDelegates();
    setSnackbar({ message: "Delegate revoked", severity: "success" });
  }, [fetchDelegates]);

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      {delegateId ? (
        <DelegateDetail
          delegateId={delegateId}
          onRevokeClick={handleDetailRevokeClick}
          onNotify={handleNotify}
        />
      ) : (
        <DelegateList
          onCreateClick={handleOpenCreate}
          onRevokeClick={handleListRevokeClick}
        />
      )}

      <CreateDelegateDialog
        open={createOpen}
        onClose={handleCloseCreate}
        onCreated={handleCreated}
      />

      {tokenData && (
        <TokenDisplay open={!!tokenData} onClose={handleCloseToken} data={tokenData} />
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
