/**
 * CasPreviewPage — preview CAS content via /cas/:key/:path
 *
 * Supports:
 * - Image files: rendered inline with proper sizing
 * - Plain text files: content displayed with truncation for large files
 * - Directory (d-node): children listing with links to child previews
 * - Other types: shows metadata with download link
 *
 * Auth is handled transparently by the Service Worker's fetch interceptor,
 * which injects the JWT and caches responses.
 */

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DescriptionIcon from "@mui/icons-material/Description";
import FolderIcon from "@mui/icons-material/Folder";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  Alert,
  Box,
  Breadcrumbs,
  Chip,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

// ============================================================================
// Constants
// ============================================================================

/** Max text bytes to display before truncating */
const MAX_TEXT_PREVIEW_BYTES = 50_000;

// ============================================================================
// Types
// ============================================================================

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string; statusCode?: number }
  | { status: "directory"; data: DirData }
  | { status: "image"; url: string; contentType: string; nodeKey: string }
  | { status: "text"; content: string; truncated: boolean; contentType: string; nodeKey: string }
  | { status: "unsupported"; contentType: string; nodeKey: string; casUrl: string };

type DirData = {
  key: string;
  children: Record<string, string>;
};

// ============================================================================
// Helpers
// ============================================================================

function isImageType(ct: string): boolean {
  return ct.startsWith("image/");
}

function isTextType(ct: string): boolean {
  if (ct.startsWith("text/")) return true;
  const textTypes = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/toml",
    "application/xhtml+xml",
    "application/svg+xml",
  ];
  return textTypes.includes(ct);
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"];
  const textExts = ["txt", "md", "json", "xml", "yaml", "yml", "toml", "ts", "tsx", "js", "jsx", "css", "html", "csv", "log"];
  if (imageExts.includes(ext)) return <ImageIcon fontSize="small" />;
  if (textExts.includes(ext)) return <DescriptionIcon fontSize="small" />;
  return <InsertDriveFileIcon fontSize="small" />;
}

/**
 * Build the /cas/ URL for a given node key and optional sub-path segments.
 */
function buildCasUrl(key: string, segments: string[] = []): string {
  const parts = ["/cas", key, ...segments];
  return parts.join("/");
}

/**
 * Build the /preview/ URL for a given node key and optional sub-path segments.
 */
function buildPreviewUrl(key: string, segments: string[] = []): string {
  const parts = ["/preview", key, ...segments];
  return parts.join("/");
}

// ============================================================================
// Component
// ============================================================================

export function CasPreviewPage() {
  const { key } = useParams<{ key: string }>();
  const location = useLocation();
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  // Extract the sub-path (everything after /preview/:key/)
  const subPath = extractSubPath(location.pathname, key);

  const casUrl = key ? buildCasUrl(key, subPath ? subPath.split("/") : []) : "";

  const fetchContent = useCallback(async () => {
    if (!key) {
      setState({ status: "error", message: "Missing node key" });
      return;
    }

    setState({ status: "loading" });

    try {
      const resp = await fetch(casUrl);

      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        setState({
          status: "error",
          message: body?.message ?? `HTTP ${resp.status}`,
          statusCode: resp.status,
        });
        return;
      }

      const contentType = resp.headers.get("Content-Type") ?? "application/octet-stream";
      const nodeKey = resp.headers.get("X-CAS-Key") ?? key;

      // Directory listing (JSON response from d-node)
      if (contentType.includes("application/json")) {
        const json = await resp.json();
        if (json.type === "dict") {
          setState({ status: "directory", data: json as DirData });
          return;
        }
        // JSON file (not a directory) — show as text
        const text = JSON.stringify(json, null, 2);
        setState({
          status: "text",
          content: text.length > MAX_TEXT_PREVIEW_BYTES ? text.slice(0, MAX_TEXT_PREVIEW_BYTES) : text,
          truncated: text.length > MAX_TEXT_PREVIEW_BYTES,
          contentType: "application/json",
          nodeKey,
        });
        return;
      }

      // Image
      if (isImageType(contentType)) {
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        setState({ status: "image", url, contentType, nodeKey });
        return;
      }

      // Text
      if (isTextType(contentType)) {
        const text = await resp.text();
        setState({
          status: "text",
          content: text.length > MAX_TEXT_PREVIEW_BYTES ? text.slice(0, MAX_TEXT_PREVIEW_BYTES) : text,
          truncated: text.length > MAX_TEXT_PREVIEW_BYTES,
          contentType,
          nodeKey,
        });
        return;
      }

      // Unsupported type — show metadata
      setState({ status: "unsupported", contentType, nodeKey, casUrl });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load content",
      });
    }
  }, [key, casUrl]);

  useEffect(() => {
    fetchContent();
    // Cleanup object URLs on unmount
    return () => {
      if (state.status === "image") {
        URL.revokeObjectURL(state.url);
      }
    };
  }, [fetchContent]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#fafafa" }}>
      {/* Header toolbar */}
      <Paper
        square
        elevation={0}
        sx={{ borderBottom: "1px solid", borderColor: "divider", px: 2 }}
      >
        <Toolbar variant="dense" disableGutters sx={{ gap: 1 }}>
          <Tooltip title="Back to explorer">
            <IconButton component={Link} to="/" size="small">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="subtitle2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
            CAS Preview
          </Typography>
          <PathBreadcrumbs nodeKey={key} subPath={subPath} />
        </Toolbar>
      </Paper>

      {/* Content */}
      <Box sx={{ maxWidth: 960, mx: "auto", p: 3 }}>
        {state.status === "loading" && <LoadingView />}
        {state.status === "error" && <ErrorView message={state.message} statusCode={state.statusCode} />}
        {state.status === "directory" && <DirectoryView data={state.data} parentKey={key!} parentSubPath={subPath} />}
        {state.status === "image" && <ImageView url={state.url} contentType={state.contentType} nodeKey={state.nodeKey} />}
        {state.status === "text" && <TextView content={state.content} truncated={state.truncated} contentType={state.contentType} nodeKey={state.nodeKey} />}
        {state.status === "unsupported" && <UnsupportedView contentType={state.contentType} nodeKey={state.nodeKey} casUrl={state.casUrl} />}
      </Box>
    </Box>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function LoadingView() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" py={10}>
      <CircularProgress size={32} />
    </Box>
  );
}

function ErrorView({ message, statusCode }: { message: string; statusCode?: number }) {
  return (
    <Alert severity="error" sx={{ mt: 2 }}>
      {statusCode && <strong>{statusCode} — </strong>}
      {message}
    </Alert>
  );
}

function DirectoryView({
  data,
  parentKey,
  parentSubPath,
}: {
  data: DirData;
  parentKey: string;
  parentSubPath: string;
}) {
  const entries = Object.entries(data.children).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, bgcolor: "#f5f5f5", borderBottom: "1px solid", borderColor: "divider" }}>
        <Box display="flex" alignItems="center" gap={1}>
          <FolderIcon fontSize="small" color="action" />
          <Typography variant="subtitle2">
            Directory — {entries.length} {entries.length === 1 ? "item" : "items"}
          </Typography>
        </Box>
      </Box>
      {entries.length === 0 ? (
        <Box px={2} py={3}>
          <Typography color="text.secondary" variant="body2">Empty directory</Typography>
        </Box>
      ) : (
        <List dense disablePadding>
          {entries.map(([name, childKey]) => {
            // Navigate into child by appending a ~N index path
            // Since we know the child key, link directly to /preview/:childKey
            const childPreviewUrl = buildPreviewUrl(childKey);
            return (
              <ListItemButton
                key={name}
                component={Link}
                to={childPreviewUrl}
                sx={{ borderBottom: "1px solid", borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {getFileIcon(name)}
                </ListItemIcon>
                <ListItemText
                  primary={name}
                  secondary={childKey}
                  primaryTypographyProps={{ variant: "body2" }}
                  secondaryTypographyProps={{ variant: "caption", fontFamily: "monospace", fontSize: "0.7em" }}
                />
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Paper>
  );
}

function ImageView({ url, contentType, nodeKey }: { url: string; contentType: string; nodeKey: string }) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, bgcolor: "#f5f5f5", borderBottom: "1px solid", borderColor: "divider" }}>
        <Box display="flex" alignItems="center" gap={1}>
          <ImageIcon fontSize="small" color="action" />
          <Typography variant="subtitle2">Image Preview</Typography>
          <Chip label={contentType} size="small" variant="outlined" sx={{ ml: "auto", fontFamily: "monospace", fontSize: "0.75em" }} />
        </Box>
        <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary", fontSize: "0.7em" }}>
          {nodeKey}
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          p: 2,
          bgcolor: "#fafafa",
          // Checkerboard pattern for transparency
          backgroundImage:
            "linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
        }}
      >
        <Box
          component="img"
          src={url}
          alt="CAS content preview"
          sx={{
            maxWidth: "100%",
            maxHeight: "70vh",
            objectFit: "contain",
            borderRadius: 1,
          }}
        />
      </Box>
    </Paper>
  );
}

function TextView({
  content,
  truncated,
  contentType,
  nodeKey,
}: {
  content: string;
  truncated: boolean;
  contentType: string;
  nodeKey: string;
}) {
  const lineCount = content.split("\n").length;

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, bgcolor: "#f5f5f5", borderBottom: "1px solid", borderColor: "divider" }}>
        <Box display="flex" alignItems="center" gap={1}>
          <DescriptionIcon fontSize="small" color="action" />
          <Typography variant="subtitle2">Text Preview</Typography>
          <Chip label={contentType} size="small" variant="outlined" sx={{ ml: "auto", fontFamily: "monospace", fontSize: "0.75em" }} />
          <Chip label={`${lineCount} lines`} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.75em" }} />
        </Box>
        <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary", fontSize: "0.7em" }}>
          {nodeKey}
        </Typography>
      </Box>
      <Box
        sx={{
          p: 2,
          overflow: "auto",
          maxHeight: "70vh",
          bgcolor: "#1e1e1e",
        }}
      >
        <Typography
          component="pre"
          sx={{
            fontFamily: "monospace",
            fontSize: "0.82em",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            m: 0,
            color: "#d4d4d4",
          }}
        >
          {content}
        </Typography>
      </Box>
      {truncated && (
        <Box sx={{ px: 2, py: 1, bgcolor: "#fff3e0", borderTop: "1px solid", borderColor: "divider" }}>
          <Typography variant="caption" color="warning.main">
            Content truncated — showing first {Math.round(MAX_TEXT_PREVIEW_BYTES / 1000)}KB
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

function UnsupportedView({ contentType, nodeKey, casUrl }: { contentType: string; nodeKey: string; casUrl: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={4}>
        <InsertDriveFileIcon sx={{ fontSize: 48, color: "text.disabled" }} />
        <Typography variant="subtitle1">Preview not available</Typography>
        <Typography variant="body2" color="text.secondary">
          Content type <Chip label={contentType} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.8em" }} /> is not supported for preview.
        </Typography>
        <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
          {nodeKey}
        </Typography>
        <MuiLink href={casUrl} target="_blank" rel="noopener" variant="body2">
          Download raw content
        </MuiLink>
      </Box>
    </Paper>
  );
}

function PathBreadcrumbs({ nodeKey, subPath }: { nodeKey?: string; subPath: string }) {
  if (!nodeKey) return null;

  const segments = subPath ? subPath.split("/").filter(Boolean) : [];

  return (
    <Breadcrumbs
      separator="/"
      sx={{ ml: 2, "& .MuiBreadcrumbs-separator": { mx: 0.5 } }}
    >
      <Typography
        variant="caption"
        sx={{ fontFamily: "monospace", fontSize: "0.8em", color: "text.secondary" }}
      >
        {nodeKey.length > 16 ? `${nodeKey.slice(0, 8)}…${nodeKey.slice(-8)}` : nodeKey}
      </Typography>
      {segments.map((seg, i) => (
        <Typography
          key={i}
          variant="caption"
          sx={{ fontFamily: "monospace", fontSize: "0.8em", color: i === segments.length - 1 ? "text.primary" : "text.secondary" }}
        >
          {seg}
        </Typography>
      ))}
    </Breadcrumbs>
  );
}

// ============================================================================
// Utilities
// ============================================================================

function extractSubPath(pathname: string, key?: string): string {
  if (!key) return "";
  const prefix = `/preview/${key}`;
  if (pathname.startsWith(prefix)) {
    const rest = pathname.slice(prefix.length);
    // Remove leading slash
    return rest.startsWith("/") ? rest.slice(1) : rest;
  }
  return "";
}
