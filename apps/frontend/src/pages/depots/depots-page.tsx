import AddOutlined from "@mui/icons-material/AddOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import { Box, Button, Typography } from "@mui/material";
import { useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { ConfirmDialog } from "../../components/common/confirm-dialog";
import { ErrorView } from "../../components/common/error-view";
import { LoadingSpinner } from "../../components/common/loading-spinner";
import { useDeleteDepot, useDepotList } from "../../hooks/use-depots";
import { CreateDepotDialog } from "./components/create-depot-dialog";
import { DepotDetailDialog } from "./components/depot-detail-dialog";
import { DepotList } from "./components/depot-list";

export function DepotsPage() {
  const { user } = useAuth();
  const realm = user?.realm ?? null;
  const { data: depots, isLoading, error, refetch } = useDepotList(realm);
  const deleteDepot = useDeleteDepot(realm);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteDepot.mutateAsync(deleteId);
    setDeleteId(null);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h5" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <StorageOutlined /> Depots
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddOutlined />}
          size="small"
          onClick={() => setCreateOpen(true)}
          disabled={!realm}
        >
          Create Depot
        </Button>
      </Box>

      {isLoading && <LoadingSpinner />}
      {error && (
        <ErrorView
          message={error instanceof Error ? error.message : "Failed to load depots"}
          onRetry={() => refetch()}
        />
      )}
      {depots && depots.length === 0 && (
        <Typography color="text.secondary">No depots found. Create one to get started.</Typography>
      )}
      {depots && depots.length > 0 && (
        <DepotList depots={depots} onViewDetail={setDetailId} onDelete={setDeleteId} />
      )}

      {realm && (
        <CreateDepotDialog open={createOpen} realm={realm} onClose={() => setCreateOpen(false)} />
      )}

      <DepotDetailDialog realm={realm} depotId={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Depot?"
        message="This depot and all its data will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </Box>
  );
}
