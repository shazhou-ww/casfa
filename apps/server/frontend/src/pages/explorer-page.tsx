/**
 * ExplorerPage — thin wrapper around @casfa/explorer.
 *
 * - When depotId is in the URL, opens that depot directly.
 * - When no depotId, shows the built-in depot selector.
 * - Syncs URL on depot change via onDepotChange callback.
 * - Shows a clickable sync indicator — expand to see per-key progress.
 */

import type { CasfaClient } from "@casfa/client";
import type { StorageProvider } from "@casfa/core";
import { CasfaExplorer } from "@casfa/explorer";
import {
  CheckCircle,
  CloudDone,
  CloudSync,
  Error as ErrorIcon,
  ExpandLess,
  ExpandMore,
} from "@mui/icons-material";
import {
  Box,
  CircularProgress,
  Collapse,
  Fade,
  IconButton,
  List,
  ListItem,
  Paper,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";
import {
  clearSyncLog,
  flushStorage,
  getKeyProvider,
  getStorage,
  getSyncLog,
  onSyncLogChange,
  onSyncStatusChange,
  pushSyncLog,
  type SyncLogEntry,
} from "../lib/storage.ts";

export function ExplorerPage() {
  const { depotId } = useParams<{ depotId: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<CasfaClient | null>(null);
  const [storage, setStorage] = useState<StorageProvider | null>(null);
  const keyProv = getKeyProvider();

  useEffect(() => {
    getClient().then(setClient);
    getStorage().then(setStorage);
  }, []);

  const beforeCommit = useCallback(async () => {
    await flushStorage();
    // Add commit entry if any nodes were actually synced
    if (getSyncLog().length > 0) {
      pushSyncLog("commit");
    }
  }, []);

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
        keyProvider={keyProv}
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
// Sync status indicator — expandable per-key log
// ============================================================================

/**
 * Bottom-right pill: "Syncing…" / "Synced".
 * Click to expand and see individual put / commit operations.
 */
function SyncIndicator() {
  const [syncing, setSyncingState] = useState(false);
  const [showSynced, setShowSynced] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [log, setLog] = useState<readonly SyncLogEntry[]>([]);
  const wasSyncing = useRef(false);

  useEffect(() => {
    return onSyncStatusChange((isSyncing) => {
      setSyncingState(isSyncing);
      if (isSyncing) {
        wasSyncing.current = true;
        setShowSynced(false);
      } else if (wasSyncing.current) {
        setShowSynced(true);
        const timer = setTimeout(() => setShowSynced(false), 3000);
        return () => clearTimeout(timer);
      }
    });
  }, []);

  useEffect(() => {
    return onSyncLogChange(() => setLog([...getSyncLog()]));
  }, []);

  const visible = syncing || showSynced;

  // Collapse & clear when hidden
  useEffect(() => {
    if (!visible) {
      setExpanded(false);
      clearSyncLog();
    }
  }, [visible]);

  return (
    <Fade in={visible} timeout={{ enter: 200, exit: 600 }}>
      <Paper
        elevation={3}
        sx={{
          position: "fixed",
          bottom: 16,
          right: 16,
          minWidth: 200,
          maxWidth: 340,
          zIndex: 1300,
          overflow: "hidden",
        }}
      >
        {/* Header — click to expand */}
        <Box
          onClick={() => log.length > 0 && setExpanded((v) => !v)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.5,
            py: 0.75,
            cursor: log.length > 0 ? "pointer" : "default",
            userSelect: "none",
            borderBottom: expanded ? 1 : 0,
            borderColor: "divider",
          }}
        >
          {syncing ? (
            <CloudSync fontSize="small" color="primary" />
          ) : (
            <CloudDone fontSize="small" color="success" />
          )}
          <Typography
            variant="caption"
            color={syncing ? "text.secondary" : "success.main"}
            sx={{ flex: 1, fontWeight: 500 }}
          >
            {syncing ? "Syncing…" : "Synced"}
          </Typography>
          {log.length > 0 && (
            <IconButton size="small" sx={{ p: 0 }}>
              {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </IconButton>
          )}
        </Box>

        {/* Per-key log */}
        <Collapse in={expanded}>
          <List dense disablePadding sx={{ maxHeight: 240, overflow: "auto" }}>
            {log.map((entry) => (
              <ListItem key={entry.id} sx={{ py: 0.125, px: 1.5, minHeight: 26 }}>
                <LogEntryIcon status={entry.status} />
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
                >
                  {entry.label}
                </Typography>
              </ListItem>
            ))}
          </List>
        </Collapse>
      </Paper>
    </Fade>
  );
}

function LogEntryIcon({ status }: { status: SyncLogEntry["status"] }) {
  if (status === "active") {
    return <CircularProgress size={12} sx={{ mr: 1, flexShrink: 0 }} />;
  }
  if (status === "done") {
    return <CheckCircle sx={{ fontSize: 14, mr: 1, flexShrink: 0, color: "success.main" }} />;
  }
  return <ErrorIcon sx={{ fontSize: 14, mr: 1, flexShrink: 0, color: "error.main" }} />;
}
