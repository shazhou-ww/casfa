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
import {
  CasfaExplorer,
  type ConflictEvent,
  type FlushableStorage,
  type SyncManager,
  type SyncState,
  createSyncManager,
} from "@casfa/explorer";
import {
  CheckCircle,
  CloudDone,
  CloudOff,
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
  Snackbar,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getClient } from "../lib/client.ts";
import {
  clearSyncLog,
  getKeyProvider,
  getStorage,
  getSyncLog,
  onSyncLogChange,
  onSyncStatusChange,
  setSyncManager,
  type SyncLogEntry,
} from "../lib/storage.ts";
import { createSyncQueueStore } from "../lib/sync-queue-store.ts";

export function ExplorerPage() {
  const { depotId } = useParams<{ depotId: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<CasfaClient | null>(null);
  const [storage, setStorage] = useState<StorageProvider | null>(null);
  const keyProv = getKeyProvider();

  const syncManagerRef = useRef<SyncManager | null>(null);
  const [conflictToast, setConflictToast] = useState<string | null>(null);

  useEffect(() => {
    getClient().then(setClient);
    getStorage().then(setStorage);
  }, []);

  // Initialize SyncManager once client + storage are ready
  useEffect(() => {
    if (!client || !storage || syncManagerRef.current) return;

    const queueStore = createSyncQueueStore();
    const mgr = createSyncManager({
      storage: storage as unknown as FlushableStorage,
      client,
      queueStore,
      debounceMs: 2000,
    });

    mgr.onConflict((event: ConflictEvent) => {
      setConflictToast(
        `Conflict detected on depot ${event.depotId.slice(0, 8)}… — overwriting with local version.`
      );
    });

    // Recover any pending commits from previous session
    mgr.recover();

    syncManagerRef.current = mgr;
    setSyncManager(mgr);

    return () => {
      mgr.dispose();
      syncManagerRef.current = null;
      setSyncManager(null);
    };
  }, [client, storage]);

  const scheduleCommit = useCallback(
    (dId: string, newRoot: string, lastKnownServerRoot: string | null) => {
      syncManagerRef.current?.enqueue(dId, newRoot, lastKnownServerRoot);
    },
    []
  );

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
        scheduleCommit={scheduleCommit}
      />
      <SyncIndicator syncManager={syncManagerRef.current} />
      <Snackbar
        open={!!conflictToast}
        autoHideDuration={6000}
        onClose={() => setConflictToast(null)}
        message={conflictToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      />
    </Box>
  );
}

// ============================================================================
// Sync status indicator — expandable per-key log
// ============================================================================

/**
 * Bottom-right pill: shows Layer 1 (CAS node sync) and Layer 2 (depot commit) status.
 * Click to expand and see individual put / commit operations.
 */
function SyncIndicator({ syncManager }: { syncManager: SyncManager | null }) {
  // Layer 1 status (CAS node sync)
  const [casSyncing, setCasSyncing] = useState(false);

  // Layer 2 status (depot commit sync)
  const [syncState, setSyncState] = useState<SyncState>("idle");

  const [showSynced, setShowSynced] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [log, setLog] = useState<readonly SyncLogEntry[]>([]);
  const wasSyncing = useRef(false);

  useEffect(() => {
    return onSyncStatusChange((isSyncing) => {
      setCasSyncing(isSyncing);
    });
  }, []);

  useEffect(() => {
    if (!syncManager) return;
    return syncManager.onStateChange(setSyncState);
  }, [syncManager]);

  // Derive overall syncing state
  const isSyncing = casSyncing || syncState === "syncing" || syncState === "recovering";
  const hasError = syncState === "error" || syncState === "conflict";

  useEffect(() => {
    if (isSyncing) {
      wasSyncing.current = true;
      setShowSynced(false);
    } else if (wasSyncing.current && !hasError) {
      setShowSynced(true);
      const timer = setTimeout(() => setShowSynced(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isSyncing, hasError]);

  useEffect(() => {
    return onSyncLogChange(() => setLog([...getSyncLog()]));
  }, []);

  const visible = isSyncing || showSynced || hasError;

  // Collapse & clear when hidden
  useEffect(() => {
    if (!visible) {
      setExpanded(false);
      clearSyncLog();
    }
  }, [visible]);

  // Determine icon and label
  let icon: React.ReactNode;
  let label: string;
  let labelColor: string;

  if (hasError) {
    icon = <CloudOff fontSize="small" color="error" />;
    label = syncState === "conflict" ? "Conflict" : "Sync error — retrying…";
    labelColor = "error.main";
  } else if (isSyncing) {
    icon = <CloudSync fontSize="small" color="primary" />;
    label = syncState === "recovering" ? "Recovering…" : "Syncing…";
    labelColor = "text.secondary";
  } else {
    icon = <CloudDone fontSize="small" color="success" />;
    label = "Synced";
    labelColor = "success.main";
  }

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
          {icon}
          <Typography
            variant="caption"
            color={labelColor}
            sx={{ flex: 1, fontWeight: 500 }}
          >
            {label}
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
