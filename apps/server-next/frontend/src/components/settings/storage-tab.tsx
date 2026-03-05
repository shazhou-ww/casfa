import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, useAuth } from "../../lib/auth";

type Usage = { nodeCount?: number; totalBytes?: number } | null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function StorageTab() {
  const auth = useAuth();
  const realmId = auth?.userId ?? null;

  const [usage, setUsage] = useState<Usage>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gcLoading, setGcLoading] = useState(false);
  const [gcDialogOpen, setGcDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    message: string;
    severity: "success" | "error";
  } | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!realmId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/realm/${realmId}/usage`);
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { nodeCount?: number; totalBytes?: number };
      setUsage({
        nodeCount: data.nodeCount,
        totalBytes: data.totalBytes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [realmId]);

  useEffect(() => {
    if (realmId) {
      fetchUsage();
    }
  }, [realmId, fetchUsage]);

  const handleRunGc = useCallback(async () => {
    if (!realmId) return;
    setGcLoading(true);
    try {
      const res = await apiFetch(`/api/realm/${realmId}/gc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      setSnackbar({ message: "GC 已完成", severity: "success" });
      setGcDialogOpen(false);
      await fetchUsage();
    } catch (err) {
      setSnackbar({
        message: err instanceof Error ? err.message : String(err),
        severity: "error",
      });
    } finally {
      setGcLoading(false);
    }
  }, [realmId, fetchUsage]);

  if (!realmId) {
    return <Typography color="text.secondary">请先登录</Typography>;
  }

  return (
    <Box>
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={32} />
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!loading && usage && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography>节点数：{usage.nodeCount ?? "-"}</Typography>
          <Typography>已用：{formatBytes(usage.totalBytes ?? 0)}</Typography>
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            <Button variant="outlined" size="small" onClick={fetchUsage}>
              刷新
            </Button>
            <Button
              variant="contained"
              size="small"
              color="primary"
              onClick={() => setGcDialogOpen(true)}
            >
              运行 GC
            </Button>
          </Box>
        </Box>
      )}

      <Dialog open={gcDialogOpen} onClose={() => !gcLoading && setGcDialogOpen(false)}>
        <DialogTitle>运行 GC</DialogTitle>
        <DialogContent>
          <DialogContentText>将清理未被引用的节点，可能耗时。确定继续？</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGcDialogOpen(false)} disabled={gcLoading}>
            取消
          </Button>
          <Button onClick={handleRunGc} color="primary" variant="contained" disabled={gcLoading}>
            {gcLoading ? <CircularProgress size={20} /> : "确定"}
          </Button>
        </DialogActions>
      </Dialog>

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
