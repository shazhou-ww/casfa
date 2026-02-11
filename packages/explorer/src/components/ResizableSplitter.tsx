/**
 * <ResizableSplitter /> - Draggable vertical splitter between sidebar and main panel.
 * (Iter 3)
 */

import { Box } from "@mui/material";
import { useCallback, useRef } from "react";

type ResizableSplitterProps = {
  /** Handler called as the user drags — receives the delta X in px */
  onResize: (deltaX: number) => void;
  /** Called when drag ends */
  onResizeEnd?: () => void;
};

export function ResizableSplitter({ onResize, onResizeEnd }: ResizableSplitterProps) {
  const startXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        startXRef.current = ev.clientX;
        onResize(delta);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onResizeEnd?.();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize, onResizeEnd]
  );

  return (
    <Box
      onMouseDown={handleMouseDown}
      sx={{
        width: 4,
        minWidth: 4,
        cursor: "col-resize",
        backgroundColor: "transparent",
        transition: "background-color 0.15s",
        "&:hover": {
          backgroundColor: "action.hover",
        },
        "&:active": {
          backgroundColor: "primary.main",
        },
        flexShrink: 0,
      }}
    />
  );
}
