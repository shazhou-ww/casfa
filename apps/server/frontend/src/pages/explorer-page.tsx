/**
 * ExplorerPage — thin wrapper around @casfa/explorer.
 *
 * - When depotId is in the URL, opens that depot directly.
 * - When no depotId, shows the built-in depot selector.
 * - Syncs URL on depot change via onDepotChange callback.
 */

import { CasfaExplorer } from "@casfa/explorer";
import type { CasfaClient } from "@casfa/client";
import { Box, CircularProgress } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";

export function ExplorerPage() {
  const { depotId } = useParams<{ depotId: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<CasfaClient | null>(null);

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  if (!client) {
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
      depotId={depotId}
      height="100%"
      onDepotChange={(id) => navigate(`/depot/${encodeURIComponent(id)}`)}
    />
  );
}
