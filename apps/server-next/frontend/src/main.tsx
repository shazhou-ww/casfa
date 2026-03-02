import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

const root: Root = createRoot(rootEl);
root.render(
  <StrictMode>
    <div>CASFA</div>
  </StrictMode>
);
