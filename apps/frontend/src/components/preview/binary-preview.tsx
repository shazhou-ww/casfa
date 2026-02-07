import DownloadOutlined from "@mui/icons-material/DownloadOutlined";
import { Box, Button, Typography } from "@mui/material";

type BinaryPreviewProps = {
  name: string;
  size?: number;
  contentType?: string;
  onDownload: () => void;
};

export function BinaryPreview({ name, size, contentType, onDownload }: BinaryPreviewProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 6,
        gap: 2,
      }}
    >
      <Typography variant="h6" color="text.secondary">
        No preview available
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {name}
        {contentType && ` (${contentType})`}
        {size != null && ` — ${(size / 1024).toFixed(1)} KB`}
      </Typography>
      <Button variant="contained" startIcon={<DownloadOutlined />} onClick={onDownload}>
        Download
      </Button>
    </Box>
  );
}
