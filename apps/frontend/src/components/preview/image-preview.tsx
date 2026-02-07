import { Box } from "@mui/material";

type ImagePreviewProps = {
  blobUrl: string;
  name: string;
};

export function ImagePreview({ blobUrl, name }: ImagePreviewProps) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        p: 2,
        maxHeight: "70vh",
        overflow: "auto",
      }}
    >
      <Box
        component="img"
        src={blobUrl}
        alt={name}
        sx={{
          maxWidth: "100%",
          maxHeight: "65vh",
          objectFit: "contain",
          borderRadius: 1,
        }}
      />
    </Box>
  );
}
