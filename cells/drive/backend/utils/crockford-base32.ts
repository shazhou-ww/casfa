/**
 * Crockford Base32 encode/decode for 128-bit values (16 bytes ↔ 26 characters).
 * Alphabet: 0-9, A-Z excluding I, L, O, U (0123456789ABCDEFGHJKMNPQRSTVWXYZ).
 * Case-insensitive on decode.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function buildDecodeMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    m.set(ALPHABET[i]!, i);
    m.set(ALPHABET[i]!.toLowerCase(), i);
  }
  return m;
}

const DECODE_MAP = buildDecodeMap();

/** Encode 16 bytes (128 bits) to 26-character Crockford Base32 string. */
export function encodeCrockfordBase32(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error("encodeCrockfordBase32 requires exactly 16 bytes");
  }
  // 128 bits as big-endian BigInt; pad to 130 bits (26 * 5) for encoding
  let value = 0n;
  for (let i = 0; i < 16; i++) {
    value = (value << 8n) | BigInt(bytes[i]!);
  }
  value <<= 2n; // pad 2 zero bits (130 bits total)
  const out: string[] = [];
  for (let i = 0; i < 26; i++) {
    const shift = 125 - i * 5;
    const digit = Number((value >> BigInt(shift)) & 31n);
    out.push(ALPHABET[digit]!);
  }
  return out.join("");
}

/** Decode 26-character Crockford Base32 string to 16 bytes. Returns null if invalid. */
export function decodeCrockfordBase32(s: string): Uint8Array | null {
  if (s.length !== 26) return null;
  const upper = s.toUpperCase();
  let value = 0n;
  for (let i = 0; i < 26; i++) {
    const c = upper[i]!;
    const d = DECODE_MAP.get(c);
    if (d === undefined) return null;
    value = (value << 5n) | BigInt(d);
  }
  value >>= 2n; // drop padding to get 128 bits
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[15 - i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}
