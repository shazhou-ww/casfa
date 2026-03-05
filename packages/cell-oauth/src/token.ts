import { randomUUID } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function crockfordBase32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

export function generateDelegateId(): string {
  const uuid = randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  }
  return `dlg_${crockfordBase32Encode(bytes)}`;
}

export function generateRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createDelegateAccessToken(userId: string, delegateId: string): string {
  const payload = { sub: userId, dlg: delegateId, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = generateRandomToken();
  return `${payloadB64}.${sig}`;
}

export function decodeDelegateTokenPayload(
  token: string
): { sub: string; dlg: string; iat: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const part0 = parts[0];
  if (!part0) return null;
  try {
    const json = atob(part0.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    if (typeof payload.sub === "string" && typeof payload.dlg === "string") {
      return { sub: payload.sub, dlg: payload.dlg, iat: payload.iat ?? 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string
): Promise<boolean> {
  if (method === "S256") {
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    );
    const encoded = btoa(String.fromCharCode(...hash))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return encoded === challenge;
  }
  return verifier === challenge;
}
