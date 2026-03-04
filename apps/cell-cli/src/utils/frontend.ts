import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CellConfig } from "../config/cell-yaml-schema.js";

function toTitleCase(name: string): string {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generate index.html in the frontend directory from cell config.
 * Uses frontend.title if set, otherwise derives from cell name.
 */
export function ensureIndexHtml(frontendDir: string, config: CellConfig): void {
  if (!config.frontend) return;

  const firstEntry = Object.values(config.frontend.entries)[0];
  const entrySrc = firstEntry?.src ?? "main.tsx";
  const title = config.frontend.title ?? toTitleCase(config.name);

  writeFileSync(
    resolve(frontendDir, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entrySrc}"></script>
  </body>
</html>
`,
  );
}
