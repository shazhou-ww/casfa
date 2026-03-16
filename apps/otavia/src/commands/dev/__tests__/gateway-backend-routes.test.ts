import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadCellConfig } from "../../../config/load-cell-yaml.js";

describe("gateway backend route declarations", () => {
  test("includes oauth server callback route for popup flow", () => {
    const gatewayCellDir = resolve(import.meta.dir, "../../../../../../cells/gateway");
    const config = loadCellConfig(gatewayCellDir);
    const routes = Object.values(config.backend?.entries ?? {})
      .flatMap((entry) => entry.routes ?? []);
    expect(routes).toContain("/oauth/server/callback");
  });
});
