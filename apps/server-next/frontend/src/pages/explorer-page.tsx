import { Box, Typography } from "@mui/material";

export function ExplorerPage() {
  return (
    <Box display="flex" flexDirection="column" height="100%" p={2}>
      <Typography variant="h6">Explorer</Typography>
      <Typography variant="body2" color="text.secondary">
        Directory tree placeholder
      </Typography>
    </Box>
  );
}
