/**
 * ExplorerPage — thin wrapper around @casfa/explorer.
 *
 * - When depotId is in the URL, opens that depot directly.
 * - When no depotId, shows the built-in depot selector.
 * - Syncs URL on depot change via onDepotChange callback.
 * - Shows a clickable sync indicator — expand to see per-key progress.
 */

import type { AppClient, ViewerInfo } from "@casfa/client-bridge";
import type { StorageProvider } from "@casfa/core";
import {
  CasfaExplorer,
  type ExplorerItem,
  type ExplorerMenuItem,
  type ExplorerStoreApi,
  type SyncState,
} from "@casfa/explorer";
import {
  CheckCircle,
  CloudDone,
  CloudOff,
  CloudSync,
  Error as ErrorIcon,
  ExpandLess,
  ExpandMore,
  Extension as ExtensionIcon,
  OpenInBrowser as OpenInBrowserIcon,
  Replay as ReplayIcon,
  Warning as WarningIcon,
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
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ViewerPickerDialog } from "../components/viewer-picker-dialog.tsx";
import { getAppClient } from "../lib/client.ts";
import {
  clearSyncLog,
  getKeyProvider,
  getStorage,
  getSyncLog,
  onSyncLogChange,
  onSyncStatusChange,
  type SyncLogEntry,
} from "../lib/storage.ts";

export function ExplorerPage() {
  const { depotId } = useParams<{ depotId: string }>();
  const navigate = useNavigate();
  const [appClient, setAppClient] = useState<AppClient | null>(null);
  const [storage, setStorage] = useState<StorageProvider | null>(null);
  const keyProv = getKeyProvider();

  const [conflictToast, setConflictToast] = useState<string | null>(null);

  // ── Viewer state ──
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerPickerOpen, setViewerPickerOpen] = useState(false);
  const [viewerPickerTarget, setViewerPickerTarget] = useState<ExplorerItem | null>(null);
  const [viewerToast, setViewerToast] = useState<string | null>(null);

  const fetchViewers = useCallback(async (): Promise<ViewerInfo[]> => {
    if (!appClient) return [];
    return appClient.viewers.listAll();
  }, [appClient]);

  const handleViewerSelect = useCallback(
    (viewer: ViewerInfo) => {
      if (!viewerPickerTarget?.nodeKey) return;
      const url = `/view?target=${viewerPickerTarget.nodeKey}&viewer=${viewer.nodeKey}`;
      setViewerUrl(url);
      setViewerPickerOpen(false);
      setViewerPickerTarget(null);
    },
    [viewerPickerTarget]
  );

  const handleAddAsViewer = useCallback(
    async (item: ExplorerItem) => {
      if (!appClient || !item.nodeKey) return;
      try {
        const manifest = await appClient.viewers.readManifest(item.nodeKey);
        if (!manifest) {
          setViewerToast("Not a viewer — manifest.json missing or invalid.");
          return;
        }
        await appClient.viewers.addCustom({
          name: manifest.name,
          description: manifest.description,
          contentTypes: manifest.contentTypes,
          nodeKey: item.nodeKey,
          icon: manifest.icon,
        });
        setViewerToast(`Viewer "${manifest.name}" added successfully.`);
      } catch (err) {
        setViewerToast(`Failed to add viewer: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    },
    [appClient]
  );

  const extraContextMenuItems: ExplorerMenuItem[] = useMemo(
    () => [
      {
        key: "open-with",
        label: "Open with…",
        icon: <OpenInBrowserIcon fontSize="small" />,
        onClick: (items: ExplorerItem[]) => {
          const target = items[0];
          if (!target) return;
          setViewerPickerTarget(target);
          setViewerPickerOpen(true);
        },
      },
      {
        key: "add-as-viewer",
        label: "Add as Viewer",
        icon: <ExtensionIcon fontSize="small" />,
        onClick: (items: ExplorerItem[]) => {
          const target = items[0];
          if (!target?.isDirectory || !target.nodeKey) return;
          handleAddAsViewer(target);
        },
      },
    ],
    [handleAddAsViewer]
  );

  // Local cache of pending roots — keeps getSyncPendingRoot synchronous.
  // scheduleCommit sets the entry; onCommit clears it.
  const pendingRootsRef = useRef(new Map<string, string>());

  useEffect(() => {
    getAppClient().then(setAppClient);
    getStorage().then(setStorage);
  }, []);

  // Wire AppClient events (conflict toast + pending roots cache)
  useEffect(() => {
    if (!appClient) return;

    const unsubs = [
      appClient.onConflict((event) => {
        const depotShort = event.depotId.slice(0, 8);
        if (event.resolution === "3way-merge-success") {
          setConflictToast(`Depot ${depotShort}… — conflict resolved via 3-way merge.`);
        } else if (event.resolution === "3way-merge-failed") {
          setConflictToast(`Depot ${depotShort}… — merge failed, overwriting with local version.`);
        } else {
          setConflictToast(
            `Conflict detected on depot ${depotShort}… — overwriting with local version.`
          );
        }
      }),
      // Root updates (depotRoot, serverRoot, refresh) are handled
      // internally by the explorer store via subscribeCommit.
      // Here we only clear the pending-roots cache.
      appClient.onCommit((event) => {
        pendingRootsRef.current.delete(event.depotId);
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [appClient]);

  const scheduleCommit = useCallback(
    (dId: string, newRoot: string, lastKnownServerRoot: string | null) => {
      pendingRootsRef.current.set(dId, newRoot);
      appClient?.scheduleCommit(dId, newRoot, lastKnownServerRoot);
    },
    [appClient]
  );

  const getSyncPendingRoot = useCallback(
    async (dId: string): Promise<string | null> => {
      // First check in-memory cache (populated during this session)
      const cached = pendingRootsRef.current.get(dId);
      if (cached) return cached;
      // Fall through to AppClient — reads from SyncManager's recovered queue
      // (IndexedDB-backed, survives page refresh)
      const recovered = await appClient?.getPendingRoot(dId);
      if (recovered) {
        pendingRootsRef.current.set(dId, recovered);
      }
      return recovered ?? null;
    },
    [appClient]
  );

  const subscribeCommit = useCallback(
    (
      listener: (event: { depotId: string; committedRoot: string; requestedRoot: string }) => void
    ) => {
      return appClient?.onCommit(listener) ?? (() => {});
    },
    [appClient]
  );

  const onStoreReady = useCallback((store: ExplorerStoreApi) => {
    // Store reference available if needed for future extensions
    void store;
  }, []);

  if (!appClient || !storage) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <CasfaExplorer
        client={appClient}
        storage={storage}
        keyProvider={keyProv}
        depotId={depotId}
        height="100%"
        onDepotChange={(id) => navigate(`/depot/${encodeURIComponent(id)}`)}
        scheduleCommit={scheduleCommit}
        getSyncPendingRoot={getSyncPendingRoot}
        subscribeCommit={subscribeCommit}
        onStoreReady={onStoreReady}
        extraContextMenuItems={extraContextMenuItems}
        viewerUrl={viewerUrl}
        onViewerUrlChange={setViewerUrl}
      />
      <ViewerPickerDialog
        open={viewerPickerOpen}
        onClose={() => {
          setViewerPickerOpen(false);
          setViewerPickerTarget(null);
        }}
        onSelect={handleViewerSelect}
        targetContentType={viewerPickerTarget?.contentType ?? null}
        targetIsDirectory={viewerPickerTarget?.isDirectory ?? false}
        fetchViewers={fetchViewers}
      />
      <SyncIndicator appClient={appClient} />
      <Snackbar
        open={!!conflictToast}
        autoHideDuration={6000}
        onClose={() => setConflictToast(null)}
        message={conflictToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      />
      <Snackbar
        open={!!viewerToast}
        autoHideDuration={4000}
        onClose={() => setViewerToast(null)}
        message={viewerToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
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
 * Shows pending commit count, conflict warning, and manual retry button.
 */
function SyncIndicator({ appClient }: { appClient: AppClient | null }) {
  // Layer 1 status (CAS node sync)
  const [casSyncing, setCasSyncing] = useState(false);

  // Layer 2 status (depot commit sync via AppClient events)
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [pendingCount, setPendingCount] = useState(0);

  const [showSynced, setShowSynced] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [log, setLog] = useState<readonly SyncLogEntry[]>([]);
  const [retrying, setRetrying] = useState(false);
  const wasSyncing = useRef(false);

  useEffect(() => {
    return onSyncStatusChange((isSyncing) => {
      setCasSyncing(isSyncing);
    });
  }, []);

  useEffect(() => {
    if (!appClient) return;
    const unsubs = [
      appClient.onSyncStateChange(setSyncState),
      appClient.onPendingCountChange(setPendingCount),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [appClient]);

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

  const visible = isSyncing || showSynced || hasError || pendingCount > 0;

  // Collapse & clear when hidden
  useEffect(() => {
    if (!visible) {
      setExpanded(false);
      clearSyncLog();
    }
  }, [visible]);

  // Manual retry
  const handleRetry = useCallback(() => {
    if (!appClient || retrying) return;
    setRetrying(true);
    appClient.flushNow().finally(() => setRetrying(false));
  }, [appClient, retrying]);

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
          onClick={() => (log.length > 0 || hasError) && setExpanded((v) => !v)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.5,
            py: 0.75,
            cursor: log.length > 0 || hasError ? "pointer" : "default",
            userSelect: "none",
            borderBottom: expanded ? 1 : 0,
            borderColor: "divider",
          }}
        >
          {icon}
          <Typography variant="caption" color={labelColor} sx={{ flex: 1, fontWeight: 500 }}>
            {label}
          </Typography>
          {pendingCount > 0 && (
            <Typography
              variant="caption"
              sx={{
                bgcolor: "primary.main",
                color: "primary.contrastText",
                borderRadius: "10px",
                px: 0.75,
                py: 0,
                fontSize: "0.7rem",
                fontWeight: 600,
                lineHeight: "18px",
                minWidth: 18,
                textAlign: "center",
                flexShrink: 0,
              }}
            >
              {pendingCount > 99 ? "99+" : pendingCount}
            </Typography>
          )}
          {hasError && (
            <Tooltip title="Retry now">
              <IconButton
                size="small"
                tabIndex={-1}
                sx={{ p: 0.25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRetry();
                }}
                disabled={retrying}
              >
                {retrying ? <CircularProgress size={14} /> : <ReplayIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
          {syncState === "conflict" && (
            <Tooltip title="Conflict detected — local version will overwrite">
              <WarningIcon fontSize="small" sx={{ color: "warning.main" }} />
            </Tooltip>
          )}
          {(log.length > 0 || hasError) && (
            <IconButton size="small" tabIndex={-1} sx={{ p: 0, ml: 0.25, flexShrink: 0 }}>
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
