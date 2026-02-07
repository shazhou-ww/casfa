import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import DownloadOutlined from "@mui/icons-material/DownloadOutlined";
import DriveFileMoveOutlined from "@mui/icons-material/DriveFileMoveOutlined";
import DriveFileRenameOutlineOutlined from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import type { FsLsChild } from "../../../api/types";

type ContextMenuProps = {
  anchorPosition: { top: number; left: number } | null;
  item: FsLsChild | null;
  onClose: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

export function ContextMenu({
  anchorPosition,
  item,
  onClose,
  onOpen,
  onDownload,
  onRename,
  onMove,
  onCopy,
  onDelete,
}: ContextMenuProps) {
  if (!item) return null;

  const handleAction = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Menu
      open={!!anchorPosition}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
    >
      {item.type === "directory" && (
        <MenuItem onClick={() => handleAction(onOpen)}>
          <ListItemIcon>
            <FolderOpenOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open</ListItemText>
        </MenuItem>
      )}
      {item.type === "file" && (
        <MenuItem onClick={() => handleAction(onDownload)}>
          <ListItemIcon>
            <DownloadOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>Download</ListItemText>
        </MenuItem>
      )}
      <Divider />
      <MenuItem onClick={() => handleAction(onRename)}>
        <ListItemIcon>
          <DriveFileRenameOutlineOutlined fontSize="small" />
        </ListItemIcon>
        <ListItemText>Rename</ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleAction(onMove)}>
        <ListItemIcon>
          <DriveFileMoveOutlined fontSize="small" />
        </ListItemIcon>
        <ListItemText>Move to...</ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleAction(onCopy)}>
        <ListItemIcon>
          <ContentCopyOutlined fontSize="small" />
        </ListItemIcon>
        <ListItemText>Copy to...</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem onClick={() => handleAction(onDelete)}>
        <ListItemIcon>
          <DeleteOutlined fontSize="small" color="error" />
        </ListItemIcon>
        <ListItemText sx={{ color: "error.main" }}>Delete</ListItemText>
      </MenuItem>
    </Menu>
  );
}
