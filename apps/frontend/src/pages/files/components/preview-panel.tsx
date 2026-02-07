import CloseOutlined from "@mui/icons-material/CloseOutlined";
import { Box, Divider, Drawer, IconButton, Typography } from "@mui/material";
import type { FsLsChild } from "../../../api/types";
import { useAuth } from "../../../auth/auth-context";
import { PreviewDispatcher } from "../../../components/preview/preview-dispatcher";
import { useFileDownload } from "../../../hooks/use-file-download";
import { useFileBrowserStore } from "../../../stores/file-browser-store";

type PreviewPanelProps = {
  item: FsLsChild | null;
  onClose: () => void;
};

const DRAWER_WIDTH = 480;

export function PreviewPanel({ item, onClose }: PreviewPanelProps) {
  const { user } = useAuth();
  const realm = user?.realm ?? null;
  const { currentRoot, currentPath } = useFileBrowserStore();
  const { download } = useFileDownload();

  if (!item || !realm || !currentRoot) return null;

  const filePath = currentPath === "/" ? `/${item.name}` : `${currentPath}/${item.name}`;

  return (
    <Drawer
      anchor="right"
      open={!!item}
      onClose={onClose}
      variant="persistent"
      sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH, p: 0 } }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", p: 2 }}>
        <Typography
          variant="subtitle1"
          noWrap
          sx={{ fontWeight: 600, maxWidth: DRAWER_WIDTH - 80 }}
        >
          {item.name}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </Box>
      <Divider />
      <Box sx={{ px: 2, py: 1, display: "flex", gap: 3 }}>
        <Typography variant="caption" color="text.secondary">
          Type: {item.contentType ?? item.type}
        </Typography>
        {item.size != null && (
          <Typography variant="caption" color="text.secondary">
            Size: {(item.size / 1024).toFixed(1)} KB
          </Typography>
        )}
      </Box>
      <Divider />
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <PreviewDispatcher
          realm={realm}
          root={currentRoot}
          path={filePath}
          name={item.name}
          contentType={item.contentType}
          size={item.size}
          onDownload={() => download(item.name)}
        />
      </Box>
    </Drawer>
  );
}
