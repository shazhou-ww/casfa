import { describe, expect, test } from "bun:test";
import {
  buildMainDevGeneratedConfig,
  deriveFrontendModuleProxySpecs,
  deriveFrontendRouteRulesFromCellConfig,
  deriveRouteRulesFromCellConfig,
} from "../vite-dev.js";

describe("deriveRouteRulesFromCellConfig", () => {
  test("converts backend routes into exact/prefix rules", () => {
    const config = {
      name: "agent",
      backend: {
        runtime: "nodejs20.x",
        entries: {
          api: {
            handler: "lambda.ts",
            timeout: 30,
            memory: 1024,
            routes: ["/api/*", "/oauth/login", "/.well-known/*"],
          },
        },
      },
    } as any;

    expect(deriveRouteRulesFromCellConfig(config)).toEqual([
      { path: "/api", match: "prefix" },
      { path: "/oauth/login", match: "exact" },
      { path: "/.well-known", match: "prefix" },
    ]);
  });

  test("throws when a backend route does not start with slash", () => {
    const config = {
      name: "broken-cell",
      backend: {
        runtime: "nodejs20.x",
        entries: {
          api: {
            handler: "lambda.ts",
            timeout: 30,
            memory: 1024,
            routes: ["api/*"],
          },
        },
      },
    } as any;

    expect(() => deriveRouteRulesFromCellConfig(config)).toThrow(
      'Invalid backend route "api": route must start with "/"'
    );
  });
});

describe("buildMainDevGeneratedConfig", () => {
  test("builds mounted proxy rules from per-cell route rules", () => {
    const generated = buildMainDevGeneratedConfig(
      [
        {
          mount: "sso",
          routeRules: [
            { path: "/oauth/authorize", match: "exact" },
            { path: "/oauth/callback", match: "exact" },
          ],
          moduleProxySpecs: [],
          frontendRouteRules: [],
        },
        {
          mount: "agent",
          routeRules: [
            { path: "/api", match: "prefix" },
            { path: "/oauth/login", match: "exact" },
          ],
          moduleProxySpecs: [
            {
              mount: "agent",
              routePath: "/agent/sw.js",
              sourcePath: "/repo/apps/agent/frontend/sw.ts",
            },
          ],
          frontendRouteRules: [],
        },
      ],
      8900
    );

    expect(generated.firstMount).toBe("sso");
    expect(generated.mounts).toEqual(["sso", "agent"]);
    expect(generated.frontendModuleProxyRules).toEqual([
      {
        path: "/agent/sw.js",
        sourcePath: "/repo/apps/agent/frontend/sw.ts",
      },
    ]);
    expect(generated.proxyRules).toEqual(
      expect.arrayContaining([
        {
          mount: "agent",
          path: "/agent/api",
          match: "prefix",
          target: "http://localhost:8900",
        },
        {
          mount: "agent",
          path: "/agent/oauth/login",
          match: "exact",
          target: "http://localhost:8900",
        },
        {
          mount: "sso",
          path: "/sso/oauth/authorize",
          match: "exact",
          target: "http://localhost:8900",
        },
      ])
    );
  });
});

describe("deriveFrontendRouteRulesFromCellConfig", () => {
  test("converts frontend entry routes into mounted route rules", () => {
    const config = {
      name: "agent",
      frontend: {
        dir: "frontend",
        entries: {
          main: { entry: "index.html", routes: ["/*"] },
          sw: { entry: "sw.ts", routes: ["/sw.js"] },
        },
      },
    } as any;

    expect(deriveFrontendRouteRulesFromCellConfig("agent", config)).toEqual([
      { mount: "agent", path: "/agent", match: "prefix", entryName: "main", entryType: "html" },
      { mount: "agent", path: "/agent/sw.js", match: "exact", entryName: "sw", entryType: "module" },
    ]);
  });
});

describe("deriveFrontendModuleProxySpecs", () => {
  test("creates module proxy specs from non-html entries", () => {
    const config = {
      name: "agent",
      frontend: {
        dir: "frontend",
        entries: {
          main: { entry: "index.html", routes: ["/*"] },
          sw: { entry: "sw.ts", routes: ["/sw.js"] },
        },
      },
    } as any;

    expect(deriveFrontendModuleProxySpecs("agent", "/repo/apps/agent", config)).toEqual([
      {
        mount: "agent",
        routePath: "/agent/sw.js",
        sourcePath: "/repo/apps/agent/frontend/sw.ts",
      },
    ]);
  });

  test("throws for wildcard module routes", () => {
    const config = {
      name: "broken",
      frontend: {
        dir: "frontend",
        entries: {
          worker: { entry: "worker.ts", routes: ["/workers/*"] },
        },
      },
    } as any;

    expect(() => deriveFrontendModuleProxySpecs("broken", "/repo/apps/broken", config)).toThrow(
      'Invalid module frontend route "/workers/*" for mount "broken": wildcard routes are only supported for HTML entries'
    );
  });
});
