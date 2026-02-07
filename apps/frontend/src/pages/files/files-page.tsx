import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import type { FsLsChild } from "../../api/types";
import { useAuth } from "../../auth/auth-context";
import { ErrorView } from "../../components/common/error-view";
import { LoadingSpinner } from "../../components/common/loading-spinner";
import { useDepotList } from "../../hooks/use-depots";
import { useDirectory } from "../../hooks/use-directory";
import { useFileBrowserStore } from "../../stores/file-browser-store";
import { BreadcrumbNav } from "./components/breadcrumb-nav";
import { EmptyState } from "./components/empty-state";
import { FileList } from "./components/file-list";
import { FileToolbar } from "./components/file-toolbar";
import { PreviewPanel } from "./components/preview-panel";

export function FilesPage() {
  const { user } = useAuth();
  const realm = user?.realm ?? null;
  const { currentDepotId, currentRoot, currentPath, setDepot } = useFileBrowserStore();
  const [previewItem, setPreviewItem] = useState<FsLsChild | null>(null);

  // Load depots and auto-select first one
  const { data: depots, isLoading: depotsLoading } = useDepotList(realm);

  useEffect(() => {
    if (depots && depots.length > 0 && !currentDepotId) {
      const first = depots[0]!;
      setDepot(first.depotId, first.root);
    }
  }, [depots, currentDepotId, setDepot]);

  // Close preview when navigating
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on path change
  useEffect(() => {
    setPreviewItem(null);
  }, [currentPath]);

  // List directory
  const {
    data: dirData,
    isLoading: dirLoading,
    error: dirError,
    refetch,
  } = useDirectory(realm, currentRoot, currentPath);

  if (depotsLoading) return <LoadingSpinner />;

  if (!depots || depots.length === 0) {
    return (
      <Box>
        <Typography variant="h5" gutterBottom>
          Files
        </Typography>
        <Typography color="text.secondary">
          No depots found. Create a depot first to start managing files.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <BreadcrumbNav />
      <FileToolbar realm={realm} />
      {dirLoading && <LoadingSpinner />}
      {dirError && (
        <ErrorView
          message={dirError instanceof Error ? dirError.message : "Failed to load directory"}
          onRetry={() => refetch()}
        />
      )}
      {dirData && dirData.children.length === 0 && <EmptyState />}
      {dirData && dirData.children.length > 0 && (
        <FileList items={dirData.children} onPreview={setPreviewItem} />
      )}
      <PreviewPanel item={previewItem} onClose={() => setPreviewItem(null)} />
    </Box>
  );
}
