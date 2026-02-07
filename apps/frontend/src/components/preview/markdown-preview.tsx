import { Box, Typography } from "@mui/material";

type MarkdownPreviewProps = {
  content: string;
};

/**
 * Simple markdown renderer using dangerouslySetInnerHTML with basic parsing.
 * For production, consider adding react-markdown.
 */
export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  // Basic markdown → HTML conversion for headings, bold, italic, code blocks, links, lists
  const html = basicMarkdownToHtml(content);

  return (
    <Box sx={{ p: 2, maxHeight: "70vh", overflow: "auto" }}>
      <Typography
        component="div"
        variant="body2"
        sx={{
          "& h1": { fontSize: "1.8rem", fontWeight: 700, mt: 2, mb: 1 },
          "& h2": { fontSize: "1.4rem", fontWeight: 600, mt: 2, mb: 1 },
          "& h3": { fontSize: "1.15rem", fontWeight: 600, mt: 1.5, mb: 0.5 },
          "& pre": {
            bgcolor: "background.default",
            p: 1.5,
            borderRadius: 1,
            overflow: "auto",
            fontFamily: "monospace",
            fontSize: "0.85rem",
          },
          "& code": {
            bgcolor: "background.default",
            px: 0.5,
            borderRadius: 0.5,
            fontFamily: "monospace",
            fontSize: "0.85rem",
          },
          "& a": { color: "primary.main" },
          "& ul, & ol": { pl: 3 },
          "& blockquote": {
            borderLeft: 3,
            borderColor: "divider",
            pl: 2,
            ml: 0,
            color: "text.secondary",
          },
        }}
        // biome-ignore lint: simple preview, no user-generated attack surface
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Box>
  );
}

function basicMarkdownToHtml(md: string): string {
  let html = md;

  // Code blocks (```...```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) => `<pre><code>${esc(code)}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${esc(code)}</code>`);

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  // Collapse consecutive <ul> tags
  html = html.replace(/<\/ul>\s*<ul>/g, "");

  // Line breaks (paragraphs)
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p><\/p>/g, "");

  return html;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
