import AddOutlined from "@mui/icons-material/AddOutlined";
import VpnKeyOutlined from "@mui/icons-material/VpnKeyOutlined";
import { Box, Button, Typography } from "@mui/material";
import { useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { ConfirmDialog } from "../../components/common/confirm-dialog";
import { ErrorView } from "../../components/common/error-view";
import { LoadingSpinner } from "../../components/common/loading-spinner";
import { useRevokeToken, useTokenList } from "../../hooks/use-tokens";
import { CreateTokenDialog } from "./components/create-token-dialog";
import { TokenDetailDialog } from "./components/token-detail-dialog";
import { TokenList } from "./components/token-list";

export function TokensPage() {
  const { user } = useAuth();
  const realm = user?.realm ?? null;
  const { data: tokens, isLoading, error, refetch } = useTokenList();
  const revokeToken = useRevokeToken();

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const handleRevoke = async () => {
    if (!revokeId) return;
    await revokeToken.mutateAsync(revokeId);
    setRevokeId(null);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h5" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <VpnKeyOutlined /> Tokens
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddOutlined />}
          size="small"
          onClick={() => setCreateOpen(true)}
          disabled={!realm}
        >
          Create Token
        </Button>
      </Box>

      {isLoading && <LoadingSpinner />}
      {error && (
        <ErrorView
          message={error instanceof Error ? error.message : "Failed to load tokens"}
          onRetry={() => refetch()}
        />
      )}
      {tokens && tokens.length === 0 && (
        <Typography color="text.secondary">No tokens found. Create one to get started.</Typography>
      )}
      {tokens && tokens.length > 0 && (
        <TokenList tokens={tokens} onViewDetail={setDetailId} onRevoke={setRevokeId} />
      )}

      {realm && (
        <CreateTokenDialog open={createOpen} realm={realm} onClose={() => setCreateOpen(false)} />
      )}

      <TokenDetailDialog tokenId={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={!!revokeId}
        title="Revoke Token?"
        message="This token and all its child tokens will be permanently revoked. This action cannot be undone."
        confirmLabel="Revoke"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeId(null)}
      />
    </Box>
  );
}
