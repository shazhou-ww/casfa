function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign({ name: "HMAC", hash: "SHA-256" }, key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createMockJwt(sub: string, email?: string): Promise<string> {
  const secret = import.meta.env.VITE_MOCK_JWT_SECRET;
  if (!secret) throw new Error("VITE_MOCK_JWT_SECRET not set");

  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      sub,
      email: email ?? `${sub}@dev.local`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  );
  const sig = await hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

export function isDevMode(): boolean {
  return import.meta.env.DEV && !!import.meta.env.VITE_MOCK_JWT_SECRET;
}
