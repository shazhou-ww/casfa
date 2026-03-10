/**
 * <PdfPreview /> - PDF file preview using pdf.js.
 *
 * Renders each page of the PDF onto a <canvas>. The Service Worker
 * intercepts the CAS URL fetch and handles auth + multi-block reassembly.
 * Falls back to blob when casUrl is unavailable.
 */

import { Box, CircularProgress, IconButton, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";

type PdfPreviewProps = {
  casUrl?: string | null;
  blob?: Blob;
};

/**
 * Lazy-load pdf.js only when PdfPreview is actually rendered.
 * Caches the module so subsequent renders don't re-import.
 */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export function PdfPreview({ casUrl, blob }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);

  // Load the PDF document
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const pdfjs = await getPdfjs();

        let source: string | ArrayBuffer;
        if (casUrl) {
          // Fetch through SW (handles auth + multi-block)
          const res = await fetch(casUrl);
          if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
          source = await res.arrayBuffer();
        } else if (blob) {
          source = await blob.arrayBuffer();
        } else {
          return;
        }

        if (cancelled) return;

        const doc = await pdfjs.getDocument({ data: new Uint8Array(source) }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setPage(1);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    };
  }, [casUrl, blob]);

  // Render current page to canvas
  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || page < 1 || page > doc.numPages) return;

    // Cancel any in-flight render
    renderTaskRef.current?.cancel();

    try {
      const pdfPage = await doc.getPage(page);
      const viewport = pdfPage.getViewport({ scale });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Support HiDPI displays
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err) {
      // RenderingCancelledException is expected when navigating pages quickly
      if (err instanceof Error && err.message.includes("Rendering cancelled")) {
        return;
      }
      console.warn("[PdfPreview] render error:", err);
    }
  }, [page, scale]);

  useEffect(() => {
    if (!loading && numPages > 0) {
      renderPage();
    }
  }, [loading, numPages, renderPage]);

  if (error) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, p: 2 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <IconButton size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <span style={{ fontSize: 18 }}>◀</span>
        </IconButton>
        <Typography variant="body2">
          {page} / {numPages}
        </Typography>
        <IconButton size="small" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>
          <span style={{ fontSize: 18 }}>▶</span>
        </IconButton>
        <Box sx={{ mx: 1, borderLeft: 1, borderColor: "divider", height: 20 }} />
        <IconButton
          size="small"
          disabled={scale <= 0.5}
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
        >
          <span style={{ fontSize: 16 }}>−</span>
        </IconButton>
        <Typography variant="body2" sx={{ minWidth: 40, textAlign: "center" }}>
          {Math.round(scale * 100)}%
        </Typography>
        <IconButton
          size="small"
          disabled={scale >= 4}
          onClick={() => setScale((s) => Math.min(4, s + 0.25))}
        >
          <span style={{ fontSize: 16 }}>+</span>
        </IconButton>
      </Box>

      {/* Canvas */}
      <Box sx={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", p: 2 }}>
        <canvas ref={canvasRef} />
      </Box>
    </Box>
  );
}
