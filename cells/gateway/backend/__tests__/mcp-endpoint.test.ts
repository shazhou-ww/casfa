import { describe, expect, it } from "bun:test";
import { toMcpEndpoint } from "../services/mcp-endpoint.ts";

describe("toMcpEndpoint", () => {
  it("appends /mcp when missing", () => {
    expect(toMcpEndpoint("https://artist.example.com")).toBe("https://artist.example.com/mcp");
  });

  it("does not duplicate /mcp", () => {
    expect(toMcpEndpoint("https://artist.example.com/mcp")).toBe("https://artist.example.com/mcp");
    expect(toMcpEndpoint("https://artist.example.com/mcp/")).toBe("https://artist.example.com/mcp");
  });
});
