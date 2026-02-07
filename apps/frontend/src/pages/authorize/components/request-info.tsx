import { Box, Chip, Typography } from "@mui/material";
import type { TokenRequestDetail } from "../../../api/types";

type RequestInfoProps = {
  request: TokenRequestDetail;
};

function formatTimeRemaining(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function RequestInfo({ request }: RequestInfoProps) {
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Client Application
      </Typography>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {request.clientName}
      </Typography>

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
        Verification Code
      </Typography>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 700,
          letterSpacing: 4,
          fontFamily: "monospace",
          textAlign: "center",
          py: 1,
          mb: 2,
          bgcolor: "action.hover",
          borderRadius: 1,
        }}
      >
        {request.displayCode}
      </Typography>

      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="caption" color="text.secondary">
          Expires in: {formatTimeRemaining(request.expiresAt)}
        </Typography>
        <Chip label="Pending" color="warning" size="small" />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Confirm this code matches what the requesting application shows.
      </Typography>
    </Box>
  );
}
