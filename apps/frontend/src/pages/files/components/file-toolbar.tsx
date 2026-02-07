import CreateNewFolderOutlined from "@mui/icons-material/CreateNewFolderOutlined";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import GridViewOutlined from "@mui/icons-material/GridViewOutlined";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";
import ViewListOutlined from "@mui/icons-material/ViewListOutlined";
import { Box, Button, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useState } from "react";
import { useFileMutations } from "../../../hooks/use-file-mutations";
import { useFileBrowserStore } from "../../../stores/file-browser-store";
import { NewFolderDialog } from "./new-folder-dialog";
import { UploadDialog } from "./upload-dialog";

type FileToolbarProps = {
  realm: string | null;
};

export function FileToolbar({ realm }: FileToolbarProps) {
  const { currentDepotId, currentPath, viewMode, setViewMode, selection, clearSelection } =
    useFileBrowserStore();
  const ctx = realm && currentDepotId ? { realm, depotId: currentDepotId } : null;
  const { rm } = useFileMutations(realm, ctx);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const handleBulkDelete = async () => {
    for (const name of selection) {
      const path = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
      await rm.mutateAsync(path);
    }
    clearSelection();
  };

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Button
          startIcon={<UploadFileOutlined />}
          variant="contained"
          size="small"
          onClick={() => setUploadOpen(true)}
        >
          Upload
        </Button>
        <Button
          startIcon={<CreateNewFolderOutlined />}
          variant="outlined"
          size="small"
          onClick={() => setNewFolderOpen(true)}
        >
          New Folder
        </Button>
        {selection.size > 0 && (
          <Button
            startIcon={<DeleteOutlined />}
            color="error"
            size="small"
            onClick={handleBulkDelete}
            disabled={rm.isPending}
          >
            Delete ({selection.size})
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value="list">
            <ViewListOutlined fontSize="small" />
          </ToggleButton>
          <ToggleButton value="grid">
            <GridViewOutlined fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} realm={realm} />
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} realm={realm} />
    </>
  );
}
