import { Box, Button, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import KeyIcon from "@mui/icons-material/Key";
import { useCallback } from "react";

type DelegatesTabProps = {
  onCreateClick: () => void;
};

export function DelegatesTab({ onCreateClick }: DelegatesTabProps) {
  const handleCreate = useCallback(() => {
    onCreateClick();
  }, [onCreateClick]);

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6">Delegates</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
          Create Delegate
        </Button>
      </Box>
      <Box sx={{ textAlign: "center", py: 8 }}>
        <KeyIcon sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          No delegates yet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Create a delegate to share access with tools or collaborators
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
          Create Delegate
        </Button>
      </Box>
    </Box>
  );
}
