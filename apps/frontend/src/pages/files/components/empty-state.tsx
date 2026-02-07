import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import { Box, Typography } from "@mui/material";

export function EmptyState() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 8,
        color: "text.secondary",
      }}
    >
      <FolderOpenOutlined sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
      <Typography variant="h6">This folder is empty</Typography>
      <Typography variant="body2">Upload files or create a new folder to get started.</Typography>
    </Box>
  );
}
