import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

export type RouteMatch = "prefix" | "exact";
export type RouteRule = { path: string; match: RouteMatch };
export type ProxyRule = { mount: string; path: string; match: RouteMatch; target: string };
export type FrontendModuleProxyRule = { path: string; sourcePath: string };
export type MainDevGeneratedConfig = {
  firstMount: string;
  mounts: string[];
  routeRules: RouteRule[];
  proxyRules: ProxyRule[];
  frontendModuleProxyRules: FrontendModuleProxyRule[];
};

function isRouteMatch(v: unknown): v is RouteMatch {
  return v === "prefix" || v === "exact";
}

function isRouteRule(v: unknown): v is RouteRule {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as RouteRule).path === "string" &&
    isRouteMatch((v as RouteRule).match)
  );
}

function isProxyRule(v: unknown): v is ProxyRule {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ProxyRule).mount === "string" &&
    typeof (v as ProxyRule).path === "string" &&
    isRouteMatch((v as ProxyRule).match) &&
    typeof (v as ProxyRule).target === "string"
  );
}

function isFrontendModuleProxyRule(v: unknown): v is FrontendModuleProxyRule {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as FrontendModuleProxyRule).path === "string" &&
    typeof (v as FrontendModuleProxyRule).sourcePath === "string"
  );
}

function loadGeneratedConfig(generatedConfigPath: URL): MainDevGeneratedConfig | null {
  if (!existsSync(generatedConfigPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(generatedConfigPath, "utf-8")) as Partial<MainDevGeneratedConfig>;
    if (
      !Array.isArray(parsed.mounts) ||
      !Array.isArray(parsed.routeRules) ||
      !Array.isArray(parsed.proxyRules)
    ) {
      return null;
    }
    const mounts = parsed.mounts.filter((m): m is string => typeof m === "string");
    const routeRules = parsed.routeRules.filter(isRouteRule);
    const proxyRules = parsed.proxyRules.filter(isProxyRule);
    const frontendModuleProxyRules = Array.isArray(parsed.frontendModuleProxyRules)
      ? parsed.frontendModuleProxyRules.filter(isFrontendModuleProxyRule)
      : [];
    const firstMount = typeof parsed.firstMount === "string" ? parsed.firstMount : mounts[0] ?? "";
    return { firstMount, mounts, routeRules, proxyRules, frontendModuleProxyRules };
  } catch {
    return null;
  }
}

function toAbsoluteFsPath(sourcePath: string, packageRoot: string): string {
  const isWindowsAbs = /^[A-Za-z]:[\\/]/.test(sourcePath);
  const absolute = sourcePath.startsWith("/") || isWindowsAbs
    ? sourcePath
    : resolvePath(packageRoot, sourcePath);
  return absolute.replace(/\\/g, "/");
}

function extractMountFromPath(pathname: string, mountSet: Set<string>): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return mountSet.has(seg) ? seg : null;
}

function matchesRule(pathname: string, rule: RouteRule): boolean {
  return rule.match === "exact"
    ? pathname === rule.path
    : pathname === rule.path || pathname.startsWith(rule.path + "/");
}

function isBackendRoute(pathname: string, routeRules: RouteRule[]): boolean {
  return routeRules.some((r) => matchesRule(pathname, r));
}

function isGlobalWellKnownPath(pathname: string): boolean {
  return pathname === "/.well-known" || pathname.startsWith("/.well-known/");
}

type ConfigOptions = {
  generatedConfigPath: URL;
  packageRoot: string;
  backendPort: string;
  vitePort: number;
};

export function createMainFrontendViteConfig(options: ConfigOptions) {
  const backendTarget = `http://localhost:${options.backendPort}`;
  const generated = loadGeneratedConfig(options.generatedConfigPath);
  if (!generated) {
    throw new Error(
      `Missing or invalid generated dev config at ${options.generatedConfigPath.href}. Run otavia dev to regenerate it.`
    );
  }
  const mounts: string[] = generated.mounts;
  const mountSet = new Set(mounts);
  const firstMount = generated.firstMount;
  const routeRules: RouteRule[] = generated.routeRules;
  const frontendModuleProxyRules = generated.frontendModuleProxyRules;
  const frontendModuleProxyMap = new Map(frontendModuleProxyRules.map((r) => [r.path, r.sourcePath]));

  function mountAwareApiRewritePlugin(): Plugin {
    return {
      name: "otavia-mount-aware-api-rewrite",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url ?? "/";
          const parsed = new URL(url, "http://localhost");
          const pathname = parsed.pathname;
          const moduleSourcePath = frontendModuleProxyMap.get(pathname);
          if (moduleSourcePath) {
            req.url = `/@fs/${toAbsoluteFsPath(moduleSourcePath, options.packageRoot)}${parsed.search}`;
            next();
            return;
          }

          if (isGlobalWellKnownPath(pathname)) {
            next();
            return;
          }

          const alreadyMounted = extractMountFromPath(pathname, mountSet);
          if (alreadyMounted) {
            next();
            return;
          }
          if (!isBackendRoute(pathname, routeRules)) {
            next();
            return;
          }

          const referer = req.headers.referer;
          let mount = firstMount;
          if (referer) {
            try {
              const refPath = new URL(referer).pathname;
              const refMount = extractMountFromPath(refPath, mountSet);
              if (refMount) mount = refMount;
            } catch {
              // Ignore malformed referer.
            }
          }
          if (mount) {
            req.url = `/${mount}${pathname}${parsed.search}`;
          }
          next();
        });
      },
    };
  }

  const proxy: Record<string, object> = {};
  const proxyRules: ProxyRule[] = generated.proxyRules;
  const sortedProxyRules = proxyRules.slice().sort((a, b) => {
    if (a.path === b.path) {
      if (a.match === b.match) return 0;
      return a.match === "exact" ? -1 : 1;
    }
    return b.path.length - a.path.length;
  });
  for (const rule of sortedProxyRules) {
    if (proxy[rule.path]) continue;
    if (rule.match === "exact") {
      proxy[rule.path] = {
        target: rule.target,
        bypass(req: { url?: string }) {
          const pathname = req.url?.split("?")[0] ?? "";
          if (pathname !== rule.path) return "/index.html";
        },
      };
    } else {
      proxy[rule.path] = { target: rule.target };
    }
  }

  return defineConfig({
    plugins: [mountAwareApiRewritePlugin(), react()],
    resolve: { conditions: ["bun"], dedupe: ["react", "react-dom"] },
    server: {
      port: options.vitePort,
      host: "0.0.0.0",
      allowedHosts: true,
      strictPort: true,
      proxy,
    },
  });
}
