import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { CellConfig } from "../config/cell-yaml-schema.js";

function toTitleCase(name: string): string {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getIndexHtmlContent(config: CellConfig): string {
  if (!config.frontend) return "";
  const firstEntry = Object.values(config.frontend.entries)[0];
  const entrySrc = firstEntry?.src ?? "main.tsx";
  const title = config.frontend.title ?? toTitleCase(config.name);
  return `<!DOCTYPE html>
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
`;
}

/**
 * Vite plugin for build: use JS entry as Rollup input and emit index.html in writeBundle.
 * Lets build work without any index.html on disk.
 */
export function virtualIndexBuildPlugin(config: CellConfig, frontendDir: string): Plugin {
  if (!config.frontend) return { name: "cell-virtual-index-build", apply: "build" };
  const firstEntry = Object.values(config.frontend.entries)[0];
  const entrySrc = firstEntry?.src ?? "main.tsx";
  const title = config.frontend.title ?? toTitleCase(config.name);
  const entryPath = resolve(frontendDir, entrySrc);

  return {
    name: "cell-virtual-index-build",
    apply: "build",
    config(config) {
      return {
        build: {
          rollupOptions: {
            input: config.build?.rollupOptions?.input ?? entryPath,
          },
        },
      };
    },
    writeBundle(options, bundle) {
      const dir = options.dir ?? resolve(frontendDir, "dist");
      const entryChunk = Object.values(bundle).find(
        (o): o is { type: "chunk"; fileName: string; isEntry?: boolean } =>
          o.type === "chunk" && Boolean(o.isEntry)
      );
      const scriptSrc = entryChunk ? `/${entryChunk.fileName}` : `/${entrySrc}`;
      const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptSrc}"></script>
  </body>
</html>
`;
      writeFileSync(resolve(dir, "index.html"), html);
    },
  };
}

/**
 * Vite plugin that serves index.html virtually in dev (no file written to disk).
 * Prepend middleware so GET / and GET /index.html return the generated HTML before Vite's file server.
 */
export function virtualIndexPlugin(config: CellConfig): Plugin {
  const html = getIndexHtmlContent(config);
  return {
    name: "cell-virtual-index",
    apply: "serve",
    configureServer(server) {
      const stack = server.middlewares.stack as Array<{ route: string; handle: (req: unknown, res: unknown, next: () => void) => void }>;
      const handle = (req: { url?: string }, res: { setHeader: (a: string, b: string) => void; end: (s: string) => void }, next: () => void) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (pathname === "/" || pathname === "" || pathname === "/index.html") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
          return;
        }
        next();
      };
      stack.unshift({ route: "", handle });
    },
  };
}
