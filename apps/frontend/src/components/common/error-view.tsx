import ErrorOutlined from "@mui/icons-material/ErrorOutlined";
import { Alert, Box, Button, Typography } from "@mui/material";

type ErrorViewProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorView({ title = "Error", message, onRetry }: ErrorViewProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", p: 4, gap: 2 }}>
      <ErrorOutlined sx={{ fontSize: 48, color: "error.main" }} />
      <Typography variant="h6">{title}</Typography>
      <Alert severity="error" sx={{ maxWidth: 500 }}>
        {message}
      </Alert>
      {onRetry && (
        <Button variant="outlined" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Box>
  );
}
