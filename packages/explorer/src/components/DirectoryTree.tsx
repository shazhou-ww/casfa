/**
 * <DirectoryTree /> - Tree sidebar showing depot + folder hierarchy.
 *
 * Top-level nodes are depots. Expanding a depot selects it and loads
 * its directory tree as children. Only one depot may be expanded at a
 * time (the previously-expanded depot auto-collapses).
 */

import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import StorageIcon from "@mui/icons-material/Storage";
import {
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { TreeNode } from "../types.ts";
import { CreateDepotDialog } from "./CreateDepotDialog.tsx";
import { DeleteDepotDialog } from "./DeleteDepotDialog.tsx";

type DirectoryTreeProps = {
  onNavigate?: (path: string) => void;
};

export function DirectoryTree({ onNavigate }: DirectoryTreeProps) {
  const t = useExplorerT();
  const treeNodes = useExplorerStore((s) => s.treeNodes);
  const expandTreeNode = useExplorerStore((s) => s.expandTreeNode);
  const collapseTreeNode = useExplorerStore((s) => s.collapseTreeNode);
  const currentPath = useExplorerStore((s) => s.currentPath);
  const depotId = useExplorerStore((s) => s.depotId);
  const navigate = useExplorerStore((s) => s.navigate);
  const loadDepots = useExplorerStore((s) => s.loadDepots);
  const sidebarCollapsed = useExplorerStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useExplorerStore((s) => s.toggleSidebar);
  const permissions = useExplorerStore((s) => s.permissions);
  const depotsLoading = useExplorerStore((s) => s.depotsLoading);

  // ── Depot management dialogs ──
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ depotId: string; name: string } | null>(null);

  // ── Context menu for depot nodes ──
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    depotId: string;
    depotName: string;
  } | null>(null);

  // ── Auto-expand initial depot ──
  const initialDepotIdRef = useRef(depotId);
  const autoExpandDone = useRef(false);

  // Load depot list on mount
  useEffect(() => {
    loadDepots();
  }, [loadDepots]);

  // Auto-expand initially provided depot (from URL prop)
  useEffect(() => {
    const targetDepotId = initialDepotIdRef.current;
    if (autoExpandDone.current || !targetDepotId) return;
    const depotKey = `depot:${targetDepotId}`;
    const depotNode = treeNodes.get(depotKey);
    if (depotNode && !depotNode.isExpanded && !depotNode.isLoading) {
      autoExpandDone.current = true;
      expandTreeNode(depotKey);
    }
  }, [treeNodes, expandTreeNode]);

  // Auto-expand ancestors of the current path within the active depot
  useEffect(() => {
    if (!depotId || !currentPath) return;
    const depotKey = `depot:${depotId}`;
    const parts = currentPath.split("/");
    let accumulated = depotKey;
    for (const part of parts) {
      accumulated = `${accumulated}/${part}`;
      const node = treeNodes.get(accumulated);
      if (node && !node.isExpanded && node.children === null) {
        expandTreeNode(accumulated);
      }
    }
  }, [depotId, currentPath, treeNodes, expandTreeNode]);

  // Compute active tree key
  const activeTreeKey = depotId
    ? currentPath
      ? `depot:${depotId}/${currentPath}`
      : `depot:${depotId}`
    : "";

  const handleNodeClick = useCallback(
    (node: TreeNode) => {
      if (node.type === "depot") {
        if (!node.isExpanded) {
          expandTreeNode(node.path);
        } else {
          // Already expanded — navigate to depot root
          navigate("");
          onNavigate?.("");
        }
        return;
      }
      // Directory node: extract relative path and navigate
      if (node.depotId) {
        const prefix = `depot:${node.depotId}/`;
        const relativePath = node.path.startsWith(prefix)
          ? node.path.substring(prefix.length)
          : node.path;
        navigate(relativePath);
        onNavigate?.(relativePath);
      }
    },
    [expandTreeNode, navigate, onNavigate]
  );

  const handleToggle = useCallback(
    (node: TreeNode) => {
      if (node.isExpanded) {
        collapseTreeNode(node.path);
      } else {
        expandTreeNode(node.path);
      }
    },
    [expandTreeNode, collapseTreeNode]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode) => {
      if (node.type !== "depot" || !node.depotId || !permissions.canManageDepot) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        mouseX: e.clientX,
        mouseY: e.clientY,
        depotId: node.depotId,
        depotName: node.name,
      });
    },
    [permissions.canManageDepot]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleDeleteFromMenu = useCallback(() => {
    if (contextMenu) {
      setDeleteTarget({ depotId: contextMenu.depotId, name: contextMenu.depotName });
    }
    setContextMenu(null);
  }, [contextMenu]);

  if (sidebarCollapsed) {
    return (
      <Box
        sx={{
          width: 36,
          minWidth: 36,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          borderRight: 1,
          borderColor: "divider",
        }}
      >
        <Tooltip title={t("sidebar.expand")} placement="right">
          <IconButton size="small" onClick={toggleSidebar}>
            <MenuOpenIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  const rootNode = treeNodes.get("");

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        borderRight: 1,
        borderColor: "divider",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 36,
        }}
      >
        <Typography variant="caption" fontWeight={600} noWrap>
          {t("tree.depots")}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {permissions.canManageDepot && (
            <Tooltip title={t("depot.create")}>
              <IconButton size="small" onClick={() => setCreateOpen(true)}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t("sidebar.collapse")}>
            <IconButton size="small" onClick={toggleSidebar}>
              <MenuOpenIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Tree content */}
      <Box sx={{ flex: 1, overflow: "auto", py: 0.5 }}>
        {depotsLoading && !rootNode?.children?.length && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {rootNode?.children?.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={0}
            activeTreeKey={activeTreeKey}
            treeNodes={treeNodes}
            onToggle={handleToggle}
            onClick={handleNodeClick}
            onContextMenu={handleContextMenu}
          />
        ))}
        {!depotsLoading && rootNode?.children?.length === 0 && (
          <Box sx={{ textAlign: "center", py: 2, px: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t("depot.empty")}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Context menu for depot nodes */}
      <Menu
        open={!!contextMenu}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        <MenuItem onClick={handleDeleteFromMenu}>
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>{t("depot.delete")}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create depot dialog */}
      <CreateDepotDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Delete depot dialog */}
      <DeleteDepotDialog
        open={!!deleteTarget}
        depotId={deleteTarget?.depotId ?? null}
        depotName={deleteTarget?.name ?? null}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}

// ── Recursive tree node renderer ──

type TreeNodeItemProps = {
  node: TreeNode;
  depth: number;
  activeTreeKey: string;
  treeNodes: Map<string, TreeNode>;
  onToggle: (node: TreeNode) => void;
  onClick: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
};

function TreeNodeItem({
  node,
  depth,
  activeTreeKey,
  treeNodes,
  onToggle,
  onClick,
  onContextMenu,
}: TreeNodeItemProps) {
  const latestNode = treeNodes.get(node.path) ?? node;
  const isActive = activeTreeKey === latestNode.path;
  const isDepot = latestNode.type === "depot";

  return (
    <>
      <Box
        onClick={() => onClick(latestNode)}
        onContextMenu={(e) => onContextMenu(e, latestNode)}
        sx={{
          display: "flex",
          alignItems: "center",
          pl: 1 + depth * 1.5,
          pr: 1,
          py: 0.25,
          cursor: "pointer",
          backgroundColor: isActive ? "action.selected" : "transparent",
          "&:hover": { backgroundColor: isActive ? "action.selected" : "action.hover" },
          borderRadius: 0.5,
          mx: 0.5,
          minHeight: 28,
        }}
      >
        {/* Expand/collapse toggle */}
        <Box
          component="span"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(latestNode);
          }}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            width: 20,
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {latestNode.isLoading ? (
            <CircularProgress size={12} />
          ) : latestNode.isExpanded ? (
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
          ) : (
            <ChevronRightIcon sx={{ fontSize: 16 }} />
          )}
        </Box>

        {/* Icon */}
        {isDepot ? (
          <StorageIcon sx={{ fontSize: 16, color: "text.secondary", mr: 0.5, flexShrink: 0 }} />
        ) : latestNode.isExpanded ? (
          <FolderOpenIcon sx={{ fontSize: 16, color: "primary.main", mr: 0.5, flexShrink: 0 }} />
        ) : (
          <FolderIcon sx={{ fontSize: 16, color: "primary.main", mr: 0.5, flexShrink: 0 }} />
        )}

        {/* Name */}
        <Typography
          variant="body2"
          noWrap
          sx={{ fontSize: "0.8125rem", fontWeight: isDepot ? 500 : undefined }}
        >
          {latestNode.name}
        </Typography>
      </Box>

      {/* Children */}
      {latestNode.isExpanded &&
        latestNode.children?.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            activeTreeKey={activeTreeKey}
            treeNodes={treeNodes}
            onToggle={onToggle}
            onClick={onClick}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}
