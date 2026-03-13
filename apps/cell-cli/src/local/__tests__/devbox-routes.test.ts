import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  readRoutes,
  writeRoutes,
  registerRoute,
  unregisterRoute,
} from "../devbox-routes.js";

describe("devbox-routes", () => {
  test("readRoutes returns {} when file does not exist", () => {
    expect(readRoutes(join(tmpdir(), "nonexistent-routes.json"))).toEqual({});
  });

  test("writeRoutes and readRoutes roundtrip", () => {
    const dir = join(tmpdir(), `devbox-routes-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "routes.json");
    const routes = { "sso.casfa.my-mbp.example.com": 7100, "drive.casfa.my-mbp.example.com": 7120 };
    writeRoutes(routes, path);
    expect(readRoutes(path)).toEqual(routes);
  });

  test("registerRoute adds/updates host", () => {
    const dir = join(tmpdir(), `devbox-routes-register-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "routes.json");
    registerRoute("sso.casfa.my-mbp.example.com", 7100, path);
    expect(readRoutes(path)).toEqual({ "sso.casfa.my-mbp.example.com": 7100 });
    registerRoute("sso.casfa.my-mbp.example.com", 7101, path);
    expect(readRoutes(path)).toEqual({ "sso.casfa.my-mbp.example.com": 7101 });
  });

  test("unregisterRoute removes host", () => {
    const dir = join(tmpdir(), `devbox-routes-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "routes.json");
    writeFileSync(path, JSON.stringify({ "a.example.com": 7000, "b.example.com": 7001 }), "utf-8");
    unregisterRoute("a.example.com", path);
    expect(readRoutes(path)).toEqual({ "b.example.com": 7001 });
  });

  test("readRoutes ignores invalid entries", () => {
    const dir = join(tmpdir(), `devbox-routes-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "routes.json");
    writeFileSync(
      path,
      JSON.stringify({ "valid.example.com": 8000, "bad": "string", "also": null }),
      "utf-8"
    );
    expect(readRoutes(path)).toEqual({ "valid.example.com": 8000 });
  });
});
