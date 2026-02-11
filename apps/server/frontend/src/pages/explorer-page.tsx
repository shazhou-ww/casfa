/**
 * ExplorerPage — thin wrapper around @casfa/explorer.
 *
 * - When depotId is in the URL, opens that depot directly.
 * - When no depotId, shows the built-in depot selector.
 * - Syncs URL on depot change via onDepotChange callback.
 * - Shows a sync indicator when CAS nodes are being uploaded to the remote.
 */

import type { CasfaClient } from "@casfa/client";
import type { StorageProvider } from "@casfa/core";
import { CasfaExplorer } from "@casfa/explorer";
import { CloudDone, CloudSync } from "@mui/icons-material";
import { Box, CircularProgress, Fade, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";
import { flushStorage, getHashProvider, getStorage, onSyncStatusChange } from "../lib/storage.ts";

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

  const beforeCommit = useCallback(() => flushStorage(), []);

  if (!client || !storage) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <CasfaExplorer
        key={depotId ?? "__no_depot__"}
        client={client}
        storage={storage}
        hash={hash}
        depotId={depotId}
        height="100%"
        onDepotChange={(id) => navigate(`/depot/${encodeURIComponent(id)}`)}
        beforeCommit={beforeCommit}
      />
      <SyncIndicator />
    </Box>
  );
}

// ============================================================================
// Sync status indicator
// ============================================================================

/**
 * Shows "Syncing…" while nodes are uploading, then briefly flashes "Synced".
 * Uses a single always-mounted DOM node so MUI Fade never gets a null ref.
 */
function SyncIndicator() {
  const [syncing, setSyncing] = useState(false);
  const [showSynced, setShowSynced] = useState(false);
  const wasSyncing = useRef(false);

  useEffect(() => {
    return onSyncStatusChange((isSyncing) => {
      setSyncing(isSyncing);
      if (isSyncing) {
        wasSyncing.current = true;
        setShowSynced(false);
      } else if (wasSyncing.current) {
        // Sync just finished — flash "Synced" briefly
        setShowSynced(true);
        const timer = setTimeout(() => setShowSynced(false), 2000);
        return () => clearTimeout(timer);
      }
    });
  }, []);

  const visible = syncing || showSynced;

  return (
    <Fade in={visible} timeout={{ enter: 200, exit: 600 }}>
      <Tooltip title={syncing ? "Syncing to server…" : "All changes synced"} placement="left">
        <Box
          sx={{
            position: "fixed",
            bottom: 16,
            right: 16,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            bgcolor: "background.paper",
            border: 1,
            borderColor: syncing ? "divider" : "success.main",
            borderRadius: 2,
            px: 1.5,
            py: 0.75,
            boxShadow: 2,
            zIndex: 1300,
            transition: "border-color 0.3s",
          }}
        >
          {syncing ? (
            <>
              <CloudSync fontSize="small" color="primary" />
              <Typography variant="caption" color="text.secondary">
                Syncing…
              </Typography>
            </>
          ) : (
            <>
              <CloudDone fontSize="small" color="success" />
              <Typography variant="caption" color="success.main">
                Synced
              </Typography>
            </>
          )}
        </Box>
      </Tooltip>
    </Fade>
  );
}
