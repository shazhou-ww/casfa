import { Box } from "@mui/material";

type TextPreviewProps = {
  content: string;
};

export function TextPreview({ content }: TextPreviewProps) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        overflow: "auto",
        bgcolor: "background.default",
        borderRadius: 1,
        fontSize: "0.85rem",
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: "70vh",
        m: 0,
      }}
    >
      {content}
    </Box>
  );
}
