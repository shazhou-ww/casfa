/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
 * RFC 7636: https://tools.ietf.org/html/rfc7636
 *
 * Uses Web Crypto API (native in Node.js/Bun)
 */

/**
 * Generate a cryptographically random code verifier.
 * The code verifier is a high-entropy cryptographic random string
 * using unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 * with a minimum length of 43 characters and a maximum length of 128 characters.
 */
export function generateCodeVerifier(length = 64): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  let result = "";

  for (let i = 0; i < length; i++) {
    const byte = randomBytes[i]!;
    result += charset[byte % charset.length];
  }

  return result;
}

/**
 * Generate a code challenge from the code verifier using S256 method.
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hashBuffer));
}

/**
 * Base64URL encode (RFC 4648 Section 5)
 * - Replace '+' with '-'
 * - Replace '/' with '_'
 * - Remove trailing '=' padding
 */
function base64UrlEncode(bytes: Uint8Array): string {
  // Use btoa for base64 encoding
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  // Convert to base64url: replace + with -, / with _, remove padding =
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  return crypto.randomUUID();
}
