import { describe, expect, test } from "bun:test";
import {
  buildMainDevGeneratedConfig,
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
        },
        {
          mount: "agent",
          routeRules: [
            { path: "/api", match: "prefix" },
            { path: "/oauth/login", match: "exact" },
          ],
        },
      ],
      8900
    );

    expect(generated.firstMount).toBe("sso");
    expect(generated.mounts).toEqual(["sso", "agent"]);
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
