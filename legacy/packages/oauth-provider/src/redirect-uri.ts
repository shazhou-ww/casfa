/**
 * Redirect URI Validation
 *
 * Validates OAuth redirect URIs against registered patterns.
 * Supports port wildcards for localhost development
 * (e.g. "http://127.0.0.1:*" matches any port).
 */

/**
 * Check if a redirect URI matches any of the allowed patterns.
 *
 * Matching rules:
 * 1. **Exact match** — URI must be identical to the pattern
 * 2. **Port wildcard** — pattern `http://127.0.0.1:*` matches
 *    `http://127.0.0.1:12345` (any port, same protocol + hostname)
 *
 * @param uri - The redirect_uri submitted by the client
 * @param allowedPatterns - Registered URI patterns for this client
 * @returns `true` if the URI matches any pattern
 *
 * @example
 * ```ts
 * isRedirectUriAllowed("http://127.0.0.1:8080/callback", [
 *   "http://127.0.0.1:*",
 * ]); // true
 *
 * isRedirectUriAllowed("https://evil.com/callback", [
 *   "http://127.0.0.1:*",
 * ]); // false
 * ```
 */
export function isRedirectUriAllowed(uri: string, allowedPatterns: string[]): boolean {
  for (const pattern of allowedPatterns) {
    // Exact match
    if (pattern === uri) return true;

    // Port wildcard: "http://127.0.0.1:*" or "http://localhost:*"
    if (pattern.includes(":*")) {
      const prefix = pattern.split(":*")[0]!;
      if (uri.startsWith(`${prefix}:`)) {
        try {
          const parsed = new URL(uri);
          const patternParsed = new URL(pattern.replace(":*", ":0"));
          if (
            parsed.protocol === patternParsed.protocol &&
            parsed.hostname === patternParsed.hostname
          ) {
            return true;
          }
        } catch {
          // Invalid URL, skip
        }
      }
    }
  }
  return false;
}
