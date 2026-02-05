/**
 * PKCE (Proof Key for Code Exchange) implementation
 *
 * RFC 7636 - https://tools.ietf.org/html/rfc7636
 */

import type { PkceChallenge } from "./types.ts";

/**
 * Generate a random code verifier
 *
 * @param length - Length of verifier (43-128, default 64)
 * @returns URL-safe Base64 encoded random string
 */
export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new Error("Code verifier length must be between 43 and 128");
  }

  // Generate random bytes
  const bytes = new Uint8Array(Math.ceil((length * 3) / 4));
  crypto.getRandomValues(bytes);

  // Convert to URL-safe Base64
  const base64 = btoa(String.fromCharCode(...bytes));
  const urlSafe = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return urlSafe.slice(0, length);
}

/**
 * Generate code challenge from verifier using S256 method
 *
 * @param verifier - Code verifier string
 * @returns Base64URL encoded SHA-256 hash
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  // SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to URL-safe Base64
  const base64 = btoa(String.fromCharCode(...hashArray));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Generate a complete PKCE challenge
 *
 * @param verifierLength - Length of code verifier (default 64)
 * @returns PKCE challenge with verifier, challenge, and method
 */
export async function generatePkceChallenge(
  verifierLength = 64
): Promise<PkceChallenge> {
  const verifier = generateCodeVerifier(verifierLength);
  const challenge = await generateCodeChallenge(verifier);

  return {
    verifier,
    challenge,
    method: "S256",
  };
}

/**
 * Verify a code verifier against a challenge
 *
 * @param verifier - Code verifier to verify
 * @param challenge - Expected challenge
 * @returns true if verifier produces the challenge
 */
export async function verifyPkceChallenge(
  verifier: string,
  challenge: string
): Promise<boolean> {
  const computed = await generateCodeChallenge(verifier);
  return computed === challenge;
}
