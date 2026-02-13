/**
 * <ContextMenu /> - Right-click context menu for the file explorer.
 *
 * Three variants: file, folder, and blank-area.
 * Write operations are hidden when canUpload is false.
 * Cut/Copy/Paste/CAS URI are shown as disabled (Iter 4).
 */

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from "@mui/material";
import { useCallback, useMemo } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { ExplorerItem, ExplorerMenuItem } from "../types.ts";

type ContextMenuProps = {
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  /** The item right-clicked on, or null for blank area */
  targetItem: ExplorerItem | null;
  /** Extra menu items from props */
  extraItems?: ExplorerMenuItem[];
  /** Callbacks for built-in actions */
  onOpen?: (item: ExplorerItem) => void;
  onRename?: (item: ExplorerItem) => void;
  onDelete?: (items: ExplorerItem[]) => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
  onRefresh?: () => void;
  /** Clipboard callbacks (Iter 4) */
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  /** Download callback */
  onDownload?: (item: ExplorerItem) => void;
};

export function ContextMenu({
  anchorPosition,
  onClose,
  targetItem,
  extraItems,
  onOpen,
  onRename,
  onDelete,
  onNewFolder,
  onUpload,
  onRefresh,
  onCopy,
  onCut,
  onPaste,
  canPaste = false,
  onDownload,
}: ContextMenuProps) {
  const t = useExplorerT();
  const selectedItems = useExplorerStore((s) => s.selectedItems);
  const permissions = useExplorerStore((s) => s.permissions);
  const { canUpload } = permissions;

  // Determine if we're in multi-select mode
  const isMultiSelect = selectedItems.length > 1;

  const handleAction = useCallback(
    (action: () => void) => () => {
      action();
      onClose();
    },
    [onClose]
  );

  const menuItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      icon: React.ReactNode;
      shortcut?: string;
      onClick: () => void;
      disabled: boolean;
      hidden: boolean;
      dividerAfter?: boolean;
    }> = [];

    if (isMultiSelect) {
      // ── Multi-select menu ──
      items.push(
        {
          key: "cut",
          label: t("menu.cut"),
          icon: <ContentCutIcon fontSize="small" />,
          shortcut: "⌘X",
          onClick: () => onCut?.(),
          disabled: false,
          hidden: !canUpload,
        },
        {
          key: "copy",
          label: t("menu.copy"),
          icon: <ContentCopyIcon fontSize="small" />,
          shortcut: "⌘C",
          onClick: () => onCopy?.(),
          disabled: false,
          hidden: false,
          dividerAfter: true,
        },
        {
          key: "delete",
          label: t("menu.delete"),
          icon: <DeleteIcon fontSize="small" />,
          shortcut: "⌫",
          onClick: () => onDelete?.(selectedItems),
          disabled: false,
          hidden: !canUpload,
        }
      );
    } else if (targetItem) {
      if (targetItem.isDirectory) {
        // ── Folder menu ──
        items.push(
          {
            key: "open",
            label: t("menu.open"),
            icon: <FolderOpenIcon fontSize="small" />,
            onClick: () => onOpen?.(targetItem),
            disabled: false,
            hidden: false,
            dividerAfter: true,
          },
          {
            key: "cut",
            label: t("menu.cut"),
            icon: <ContentCutIcon fontSize="small" />,
            shortcut: "⌘X",
            onClick: () => onCut?.(),
            disabled: false,
            hidden: !canUpload,
          },
          {
            key: "copy",
            label: t("menu.copy"),
            icon: <ContentCopyIcon fontSize="small" />,
            shortcut: "⌘C",
            onClick: () => onCopy?.(),
            disabled: false,
            hidden: false,
          },
          {
            key: "paste",
            label: t("menu.paste"),
            icon: <ContentPasteIcon fontSize="small" />,
            shortcut: "⌘V",
            onClick: () => onPaste?.(),
            disabled: !canPaste,
            hidden: !canUpload,
            dividerAfter: true,
          },
          {
            key: "rename",
            label: t("menu.rename"),
            icon: <DriveFileRenameOutlineIcon fontSize="small" />,
            shortcut: "F2",
            onClick: () => onRename?.(targetItem),
            disabled: false,
            hidden: !canUpload,
          },
          {
            key: "delete",
            label: t("menu.delete"),
            icon: <DeleteIcon fontSize="small" />,
            shortcut: "⌫",
            onClick: () => onDelete?.([targetItem]),
            disabled: false,
            hidden: !canUpload,
            dividerAfter: true,
          },
          {
            key: "newFolder",
            label: t("menu.newFolder"),
            icon: <CreateNewFolderIcon fontSize="small" />,
            onClick: () => onNewFolder?.(),
            disabled: false,
            hidden: !canUpload,
          },
          {
            key: "upload",
            label: t("toolbar.upload"),
            icon: <UploadFileIcon fontSize="small" />,
            onClick: () => onUpload?.(),
            disabled: false,
            hidden: !canUpload,
          }
        );
      } else {
        // ── File menu ──
        items.push(
          {
            key: "open",
            label: t("menu.open"),
            icon: <FolderOpenIcon fontSize="small" />,
            onClick: () => onOpen?.(targetItem),
            disabled: false,
            hidden: false,
            dividerAfter: true,
          },
          {
            key: "cut",
            label: t("menu.cut"),
            icon: <ContentCutIcon fontSize="small" />,
            shortcut: "⌘X",
            onClick: () => onCut?.(),
            disabled: false,
            hidden: !canUpload,
          },
          {
            key: "copy",
            label: t("menu.copy"),
            icon: <ContentCopyIcon fontSize="small" />,
            shortcut: "⌘C",
            onClick: () => onCopy?.(),
            disabled: false,
            hidden: false,
          },
          {
            key: "download",
            label: t("menu.download"),
            icon: <DownloadIcon fontSize="small" />,
            onClick: () => onDownload?.(targetItem),
            disabled: false,
            hidden: false,
            dividerAfter: true,
          },
          {
            key: "rename",
            label: t("menu.rename"),
            icon: <DriveFileRenameOutlineIcon fontSize="small" />,
            shortcut: "F2",
            onClick: () => onRename?.(targetItem),
            disabled: false,
            hidden: !canUpload,
          },
          {
            key: "delete",
            label: t("menu.delete"),
            icon: <DeleteIcon fontSize="small" />,
            shortcut: "⌫",
            onClick: () => onDelete?.([targetItem]),
            disabled: false,
            hidden: !canUpload,
          }
        );
      }
    } else {
      // ── Blank area menu ──
      items.push(
        {
          key: "paste",
          label: t("menu.paste"),
          icon: <ContentPasteIcon fontSize="small" />,
          shortcut: "⌘V",
          onClick: () => onPaste?.(),
          disabled: !canPaste,
          hidden: !canUpload,
          dividerAfter: true,
        },
        {
          key: "newFolder",
          label: t("menu.newFolder"),
          icon: <CreateNewFolderIcon fontSize="small" />,
          onClick: () => onNewFolder?.(),
          disabled: false,
          hidden: !canUpload,
        },
        {
          key: "upload",
          label: t("toolbar.upload"),
          icon: <UploadFileIcon fontSize="small" />,
          onClick: () => onUpload?.(),
          disabled: false,
          hidden: !canUpload,
          dividerAfter: true,
        },
        {
          key: "refresh",
          label: t("toolbar.refresh"),
          icon: <RefreshIcon fontSize="small" />,
          onClick: () => onRefresh?.(),
          disabled: false,
          hidden: false,
        }
      );
    }

    return items.filter((item) => !item.hidden);
  }, [
    targetItem,
    isMultiSelect,
    selectedItems,
    canUpload,
    canPaste,
    t,
    onOpen,
    onRename,
    onDelete,
    onNewFolder,
    onUpload,
    onRefresh,
    onCopy,
    onCut,
    onPaste,
    onDownload,
  ]);

  return (
    <Menu
      open={!!anchorPosition}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      slotProps={{
        paper: { sx: { minWidth: 200 } },
      }}
    >
      {menuItems.map((item) => [
        <MenuItem key={item.key} onClick={handleAction(item.onClick)} disabled={item.disabled}>
          <ListItemIcon>{item.icon}</ListItemIcon>
          <ListItemText>{item.label}</ListItemText>
          {item.shortcut && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 3 }}>
              {item.shortcut}
            </Typography>
          )}
        </MenuItem>,
        item.dividerAfter ? <Divider key={`${item.key}-divider`} /> : null,
      ])}

      {/* Extra context menu items */}
      {extraItems && extraItems.length > 0 && (
        <>
          <Divider />
          {extraItems.map((extra) => (
            <MenuItem
              key={extra.key}
              onClick={handleAction(() =>
                extra.onClick(
                  selectedItems.length > 0 ? selectedItems : targetItem ? [targetItem] : []
                )
              )}
              disabled={extra.disabled}
            >
              {extra.icon && <ListItemIcon>{extra.icon}</ListItemIcon>}
              <ListItemText>{extra.label}</ListItemText>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
