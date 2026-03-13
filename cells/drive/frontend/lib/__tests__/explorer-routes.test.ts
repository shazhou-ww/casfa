import { describe, expect, it } from "bun:test";
import { pathToRoute, routeToPath } from "../explorer-routes";

describe("explorer-routes", () => {
  it("encodes non-ascii path segments for route", () => {
    expect(pathToRoute("/文档/项目A")).toBe("/files/%E6%96%87%E6%A1%A3/%E9%A1%B9%E7%9B%AEA");
  });

  it("decodes encoded path segments from route", () => {
    expect(routeToPath("/files/%E6%96%87%E6%A1%A3/%E9%A1%B9%E7%9B%AEA")).toBe("/文档/项目A");
  });

  it("keeps malformed encoded segment as-is", () => {
    expect(routeToPath("/files/%E0%A4%A")).toBe("/%E0%A4%A");
  });
});
