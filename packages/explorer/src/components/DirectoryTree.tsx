/**
 * <DirectoryTree /> - Tree sidebar showing folder hierarchy.
 * (Iter 3)
 *
 * Only displays directories. Nodes are lazily loaded on expand.
 */

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import { Box, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { TreeNode } from "../types.ts";

type DirectoryTreeProps = {
  onNavigate?: (path: string) => void;
};

export function DirectoryTree({ onNavigate }: DirectoryTreeProps) {
  const t = useExplorerT();
  const treeNodes = useExplorerStore((s) => s.treeNodes);
  const expandTreeNode = useExplorerStore((s) => s.expandTreeNode);
  const collapseTreeNode = useExplorerStore((s) => s.collapseTreeNode);
  const currentPath = useExplorerStore((s) => s.currentPath);
  const navigate = useExplorerStore((s) => s.navigate);
  const sidebarCollapsed = useExplorerStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useExplorerStore((s) => s.toggleSidebar);

  // Load root tree node on mount
  useEffect(() => {
    const root = treeNodes.get("");
    if (!root) {
      expandTreeNode("");
    }
  }, [treeNodes, expandTreeNode]);

  // Auto-expand ancestors of the current path
  useEffect(() => {
    if (!currentPath) return;
    const parts = currentPath.split("/");
    let accumulated = "";
    for (let i = 0; i < parts.length; i++) {
      accumulated = i === 0 ? parts[i]! : `${accumulated}/${parts[i]}`;
      const node = treeNodes.get(accumulated);
      if (node && !node.isExpanded && node.children === null) {
        expandTreeNode(accumulated);
      }
    }
  }, [currentPath, treeNodes, expandTreeNode]);

  const handleNodeClick = useCallback(
    (path: string) => {
      navigate(path);
      onNavigate?.(path);
    },
    [navigate, onNavigate]
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
          Explorer
        </Typography>
        <Tooltip title={t("sidebar.collapse")}>
          <IconButton size="small" onClick={toggleSidebar}>
            <MenuOpenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tree content */}
      <Box sx={{ flex: 1, overflow: "auto", py: 0.5 }}>
        {rootNode?.children?.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={0}
            currentPath={currentPath}
            treeNodes={treeNodes}
            onToggle={handleToggle}
            onClick={handleNodeClick}
          />
        ))}
        {rootNode?.isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
            <CircularProgress size={16} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ── Recursive tree node renderer ──

type TreeNodeItemProps = {
  node: TreeNode;
  depth: number;
  currentPath: string;
  treeNodes: Map<string, TreeNode>;
  onToggle: (node: TreeNode) => void;
  onClick: (path: string) => void;
};

function TreeNodeItem({
  node,
  depth,
  currentPath,
  treeNodes,
  onToggle,
  onClick,
}: TreeNodeItemProps) {
  const isActive = currentPath === node.path;
  // Use latest node data from the map (may have been updated since parent rendered)
  const latestNode = treeNodes.get(node.path) ?? node;

  return (
    <>
      <Box
        onClick={() => onClick(latestNode.path)}
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

        {/* Folder icon */}
        {latestNode.isExpanded ? (
          <FolderOpenIcon sx={{ fontSize: 16, color: "primary.main", mr: 0.5, flexShrink: 0 }} />
        ) : (
          <FolderIcon sx={{ fontSize: 16, color: "primary.main", mr: 0.5, flexShrink: 0 }} />
        )}

        {/* Name */}
        <Typography variant="body2" noWrap sx={{ fontSize: "0.8125rem" }}>
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
            currentPath={currentPath}
            treeNodes={treeNodes}
            onToggle={onToggle}
            onClick={onClick}
          />
        ))}
    </>
  );
}
