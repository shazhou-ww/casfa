/**
 * ExplorerPage — thin wrapper around @casfa/explorer.
 *
 * - When depotId is in the URL, opens that depot directly.
 * - When no depotId, shows the built-in depot selector.
 * - Syncs URL on depot change via onDepotChange callback.
 */

import type { CasfaClient } from "@casfa/client";
import type { HashProvider, StorageProvider } from "@casfa/core";
import { CasfaExplorer } from "@casfa/explorer";
import { Box, CircularProgress } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";
import { getHashProvider, getStorage } from "../lib/storage.ts";

export function ExplorerPage() {
  const { depotId } = useParams<{ depotId: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<CasfaClient | null>(null);
  const [storage, setStorage] = useState<StorageProvider | null>(null);
  const hash = getHashProvider();

  useEffect(() => {
    getClient().then(setClient);
    getStorage().then(setStorage);
  }, []);

  if (!client || !storage) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <CasfaExplorer
      key={depotId ?? "__no_depot__"}
      client={client}
      storage={storage}
      hash={hash}
      depotId={depotId}
      height="100%"
      onDepotChange={(id) => navigate(`/depot/${encodeURIComponent(id)}`)}
    />
  );
}
