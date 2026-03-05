import { describe, expect, it } from "bun:test";
import { prependUtf8BomIfText, UTF8_BOM } from "../../utils/utf8-bom.ts";

describe("utf8-bom", () => {
  it("UTF8_BOM has length 3 and correct bytes", () => {
    expect(UTF8_BOM.length).toBe(3);
    expect(UTF8_BOM[0]).toBe(0xef);
    expect(UTF8_BOM[1]).toBe(0xbb);
    expect(UTF8_BOM[2]).toBe(0xbf);
  });

  it("prependUtf8BomIfText adds BOM for text/plain", () => {
    const bytes = new TextEncoder().encode("Hello 世界");
    const out = prependUtf8BomIfText("text/plain", bytes);
    expect(out.length).toBe(3 + bytes.length);
    expect(out[0]).toBe(0xef);
    expect(out[1]).toBe(0xbb);
    expect(out[2]).toBe(0xbf);
    expect(new TextDecoder().decode(out.subarray(3))).toBe("Hello 世界");
  });

  it("prependUtf8BomIfText adds BOM for text/markdown", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = prependUtf8BomIfText("text/markdown", bytes);
    expect(out.length).toBe(6);
    expect(out.subarray(0, 3)).toEqual(UTF8_BOM);
    expect(out.subarray(3)).toEqual(bytes);
  });

  it("prependUtf8BomIfText returns same buffer for application/octet-stream", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = prependUtf8BomIfText("application/octet-stream", bytes);
    expect(out).toBe(bytes);
    expect(out.length).toBe(3);
  });

  it("prependUtf8BomIfText returns same buffer for application/json", () => {
    const bytes = new TextEncoder().encode("{}");
    const out = prependUtf8BomIfText("application/json", bytes);
    expect(out).toBe(bytes);
  });
});
