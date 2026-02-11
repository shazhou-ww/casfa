/**
 * Utility function tests
 */
import { describe, expect, it } from "bun:test";
import {
  bytesToHex,
  computeSizeFlagByte,
  concatBytes,
  decodePascalString,
  decodePascalStrings,
  decodeSizeFlagByte,
  encodePascalString,
  encodePascalStrings,
  hashToKey,
  hexToBytes,
  keyToHash,
} from "../src/utils.ts";

describe("Utils", () => {
  describe("Pascal strings", () => {
    it("should encode empty string", () => {
      const encoded = encodePascalString("");
      expect(encoded).toEqual(new Uint8Array([0, 0]));
    });

    it("should encode ASCII string", () => {
      const encoded = encodePascalString("hello");
      expect(encoded[0]).toBe(5); // length low byte
      expect(encoded[1]).toBe(0); // length high byte
      expect(encoded.slice(2)).toEqual(new TextEncoder().encode("hello"));
    });

    it("should roundtrip ASCII string", () => {
      const original = "hello world";
      const encoded = encodePascalString(original);
      const [decoded, consumed] = decodePascalString(encoded, 0);
      expect(decoded).toBe(original);
      expect(consumed).toBe(2 + original.length);
    });

    it("should roundtrip unicode string", () => {
      const original = "你好世界 🌍";
      const encoded = encodePascalString(original);
      const [decoded, _consumed] = decodePascalString(encoded, 0);
      expect(decoded).toBe(original);
    });

    it("should throw on string too long", () => {
      const long = "x".repeat(70000);
      expect(() => encodePascalString(long)).toThrow(/too long/);
    });

    it("should encode multiple strings", () => {
      const strings = ["foo", "bar", "baz"];
      const encoded = encodePascalStrings(strings);
      const decoded = decodePascalStrings(encoded, 0, 3);
      expect(decoded).toEqual(strings);
    });

    it("should handle empty strings array", () => {
      const encoded = encodePascalStrings([]);
      expect(encoded.length).toBe(0);
      const decoded = decodePascalStrings(encoded, 0, 0);
      expect(decoded).toEqual([]);
    });
  });

  describe("Hex conversion", () => {
    it("should convert bytes to hex", () => {
      const bytes = new Uint8Array([0x00, 0x01, 0xff, 0xab]);
      expect(bytesToHex(bytes)).toBe("0001ffab");
    });

    it("should convert hex to bytes", () => {
      const hex = "0001ffab";
      expect(hexToBytes(hex)).toEqual(new Uint8Array([0x00, 0x01, 0xff, 0xab]));
    });

    it("should roundtrip bytes", () => {
      const original = new Uint8Array([0, 127, 255, 16, 32]);
      expect(hexToBytes(bytesToHex(original))).toEqual(original);
    });

    it("should throw on odd-length hex", () => {
      expect(() => hexToBytes("abc")).toThrow(/even length/);
    });

    it("should handle empty input", () => {
      expect(bytesToHex(new Uint8Array([]))).toBe("");
      expect(hexToBytes("")).toEqual(new Uint8Array([]));
    });
  });

  describe("concatBytes", () => {
    it("should concatenate arrays", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([3, 4, 5]);
      const c = new Uint8Array([6]);
      expect(concatBytes(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    it("should handle empty arrays", () => {
      expect(concatBytes()).toEqual(new Uint8Array([]));
      expect(concatBytes(new Uint8Array([]))).toEqual(new Uint8Array([]));
    });
  });

  describe("Hash key conversion", () => {
    it("should create CB32 key (no prefix)", () => {
      const hash = new Uint8Array(16).fill(0xab);
      const key = hashToKey(hash);
      // 16 bytes of 0xab → CB32 encoded
      expect(key.length).toBe(26);
      // Roundtrip should reproduce same bytes
      expect(keyToHash(key)).toEqual(hash);
    });

    it("should extract hash from CB32 key", () => {
      // Encode then decode
      const original = new Uint8Array(16).fill(0xcd);
      const key = hashToKey(original);
      const hash = keyToHash(key);
      expect(hash).toEqual(original);
    });

    it("should roundtrip hash", () => {
      const original = new Uint8Array(16);
      for (let i = 0; i < 16; i++) original[i] = i;
      expect(keyToHash(hashToKey(original))).toEqual(original);
    });
  });

  // ==========================================================================
  // Size Flag Byte
  // ==========================================================================

  describe("computeSizeFlagByte", () => {
    it("should return 0x00 for size 0", () => {
      expect(computeSizeFlagByte(0)).toBe(0x00);
    });

    it("should return 0x00 for negative size", () => {
      expect(computeSizeFlagByte(-1)).toBe(0x00);
    });

    it("should encode small sizes (H=0, L=size)", () => {
      expect(computeSizeFlagByte(1)).toBe(0x01);
      expect(computeSizeFlagByte(5)).toBe(0x05);
      expect(computeSizeFlagByte(15)).toBe(0x0f);
    });

    it("should step to H=1 for size 16", () => {
      // L=1, 16^1 = 16 → 1×16 = 16
      expect(computeSizeFlagByte(16)).toBe(0x11);
    });

    it("should encode mid-range H=1 values", () => {
      // size=17 → ceil(17/16)=2 → H=1, L=2 → 0x12
      expect(computeSizeFlagByte(17)).toBe(0x12);
      // size=240 → ceil(240/16)=15 → H=1, L=15 → 0x1F
      expect(computeSizeFlagByte(240)).toBe(0x1f);
    });

    it("should step to H=2 for size 241", () => {
      // ceil(241/16)=16 > 15, so H=1 fails → H=2: ceil(241/256)=1 → 0x21
      expect(computeSizeFlagByte(241)).toBe(0x21);
    });

    it("should encode size 256 as H=2, L=1", () => {
      expect(computeSizeFlagByte(256)).toBe(0x21);
    });

    it("should encode exactly at tier boundary", () => {
      // 15 × 256 = 3840 → H=2, L=15
      expect(computeSizeFlagByte(3840)).toBe(0x2f);
      // 3841 → H=3: ceil(3841/4096)=1 → 0x31
      expect(computeSizeFlagByte(3841)).toBe(0x31);
    });

    it("should encode 1 MB correctly", () => {
      const oneMB = 1024 * 1024;
      const flag = computeSizeFlagByte(oneMB);
      const H = (flag >> 4) & 0x0f;
      const L = flag & 0x0f;
      const bound = L * 16 ** H;
      // bound must be >= 1MB and be the tightest fit
      expect(bound).toBeGreaterThanOrEqual(oneMB);
      // check there's no smaller valid encoding
      if (L > 1) {
        expect((L - 1) * 16 ** H).toBeLessThan(oneMB);
      }
    });

    it("should return 0xFF for extremely large size", () => {
      // 15 × 16^15 is the max
      const maxRepresentable = 15 * 16 ** 15;
      expect(computeSizeFlagByte(maxRepresentable)).toBe(0xff);
    });
  });

  describe("decodeSizeFlagByte", () => {
    it("should decode 0x00 to 0", () => {
      expect(decodeSizeFlagByte(0x00)).toBe(0);
    });

    it("should decode L=0 flags to 0 (layer separators)", () => {
      expect(decodeSizeFlagByte(0x10)).toBe(0);
      expect(decodeSizeFlagByte(0x20)).toBe(0);
      expect(decodeSizeFlagByte(0xf0)).toBe(0);
    });

    it("should decode H=0 values", () => {
      expect(decodeSizeFlagByte(0x01)).toBe(1);
      expect(decodeSizeFlagByte(0x0f)).toBe(15);
    });

    it("should decode H=1 values", () => {
      expect(decodeSizeFlagByte(0x11)).toBe(16);
      expect(decodeSizeFlagByte(0x1f)).toBe(240);
    });

    it("should decode H=2 values", () => {
      expect(decodeSizeFlagByte(0x21)).toBe(256);
      expect(decodeSizeFlagByte(0x2f)).toBe(3840);
    });

    it("should decode 0xFF (max)", () => {
      expect(decodeSizeFlagByte(0xff)).toBe(15 * 16 ** 15);
    });
  });

  describe("size flag byte: roundtrip & properties", () => {
    it("encode → decode should produce a bound >= original size", () => {
      const testSizes = [0, 1, 15, 16, 17, 100, 240, 241, 255, 256, 1000, 3840, 3841, 4096, 65536, 1024 * 1024];
      for (const size of testSizes) {
        const flag = computeSizeFlagByte(size);
        const bound = decodeSizeFlagByte(flag);
        expect(bound).toBeGreaterThanOrEqual(size);
      }
    });

    it("monotonicity: larger size → larger or equal flag byte", () => {
      let prevFlag = 0;
      const sizes = [0, 1, 2, 10, 15, 16, 100, 240, 241, 256, 1000, 3840, 3841, 65536, 1024 * 1024, 16 * 1024 * 1024];
      for (const size of sizes) {
        const flag = computeSizeFlagByte(size);
        expect(flag).toBeGreaterThanOrEqual(prevFlag);
        prevFlag = flag;
      }
    });

    it("strict monotonicity: flag byte order matches decoded bound order", () => {
      // For all valid non-zero flag bytes, check that byte value order = bound order
      const entries: { flag: number; bound: number }[] = [];
      for (let flag = 0; flag <= 0xff; flag++) {
        const bound = decodeSizeFlagByte(flag);
        if (bound > 0) {
          entries.push({ flag, bound });
        }
      }
      for (let i = 1; i < entries.length; i++) {
        if (entries[i]!.flag > entries[i - 1]!.flag) {
          expect(entries[i]!.bound).toBeGreaterThanOrEqual(entries[i - 1]!.bound);
        }
      }
    });

    it("tightness: no smaller flag byte can cover the same size", () => {
      const testSizes = [1, 16, 17, 240, 241, 256, 3840, 3841, 65536];
      for (const size of testSizes) {
        const flag = computeSizeFlagByte(size);
        if (flag > 0x01) {
          // The previous valid flag byte's bound should be < size
          // (otherwise our encoding isn't tight)
          let prevFlag = flag - 1;
          // skip L=0 layer separators
          while (prevFlag > 0 && (prevFlag & 0x0f) === 0) {
            prevFlag--;
          }
          if (prevFlag > 0) {
            const prevBound = decodeSizeFlagByte(prevFlag);
            expect(prevBound).toBeLessThan(size);
          }
        }
      }
    });

    it("all 256 flag values decode without error", () => {
      for (let flag = 0; flag <= 0xff; flag++) {
        expect(() => decodeSizeFlagByte(flag)).not.toThrow();
      }
    });
  });
});
