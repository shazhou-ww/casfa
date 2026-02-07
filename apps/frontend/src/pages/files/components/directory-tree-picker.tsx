import ChevronRightOutlined from "@mui/icons-material/ChevronRightOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import {
  Box,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { filesystemApi } from "../../../api/filesystem";
import type { FsLsChild } from "../../../api/types";

type TreeNode = {
  name: string;
  path: string;
  loaded: boolean;
  children: TreeNode[];
};

type DirectoryTreePickerProps = {
  realm: string;
  root: string;
  selected: string;
  onSelect: (path: string) => void;
};

function TreeItem({
  node,
  depth,
  selected,
  onSelect,
  onExpand,
  expandedPaths,
  loadingPaths,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
  onExpand: (node: TreeNode) => void;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.path);
  const isSelected = selected === node.path;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand(node);
  };

  return (
    <>
      <ListItemButton
        selected={isSelected}
        onClick={() => onSelect(node.path)}
        sx={{ pl: 2 + depth * 2 }}
        dense
      >
        <Box
          onClick={handleToggle}
          sx={{ display: "flex", alignItems: "center", mr: 0.5, cursor: "pointer" }}
        >
          {isLoading ? (
            <CircularProgress size={16} />
          ) : isExpanded ? (
            <ExpandMoreOutlined fontSize="small" />
          ) : (
            <ChevronRightOutlined fontSize="small" />
          )}
        </Box>
        <ListItemIcon sx={{ minWidth: 32 }}>
          {isExpanded ? (
            <FolderOpenOutlined fontSize="small" />
          ) : (
            <FolderOutlined fontSize="small" />
          )}
        </ListItemIcon>
        <ListItemText primary={node.name} primaryTypographyProps={{ variant: "body2" }} />
      </ListItemButton>
      {isExpanded &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            onExpand={onExpand}
            expandedPaths={expandedPaths}
            loadingPaths={loadingPaths}
          />
        ))}
    </>
  );
}

export function DirectoryTreePicker({ realm, root, selected, onSelect }: DirectoryTreePickerProps) {
  const [rootNode, setRootNode] = useState<TreeNode>({
    name: "/",
    path: "/",
    loaded: false,
    children: [],
  });
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  const loadChildren = useCallback(
    async (node: TreeNode): Promise<TreeNode[]> => {
      const res = await filesystemApi.ls(realm, root, node.path);
      return res.children
        .filter((c: FsLsChild) => c.type === "directory")
        .map((c: FsLsChild) => ({
          name: c.name,
          path: node.path === "/" ? `/${c.name}` : `${node.path}/${c.name}`,
          loaded: false,
          children: [],
        }));
    },
    [realm, root]
  );

  const updateNodeInTree = (tree: TreeNode, path: string, children: TreeNode[]): TreeNode => {
    if (tree.path === path) {
      return { ...tree, loaded: true, children };
    }
    return {
      ...tree,
      children: tree.children.map((c) => updateNodeInTree(c, path, children)),
    };
  };

  const handleExpand = async (node: TreeNode) => {
    if (expandedPaths.has(node.path)) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
      return;
    }

    if (!node.loaded) {
      setLoadingPaths((prev) => new Set(prev).add(node.path));
      const children = await loadChildren(node);
      setRootNode((prev) => updateNodeInTree(prev, node.path, children));
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    }

    setExpandedPaths((prev) => new Set(prev).add(node.path));
  };

  return (
    <Box
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 300, overflow: "auto" }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 1, display: "block" }}>
        Select destination folder
      </Typography>
      <List dense disablePadding>
        <TreeItem
          node={rootNode}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          onExpand={handleExpand}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
        />
      </List>
    </Box>
  );
}
