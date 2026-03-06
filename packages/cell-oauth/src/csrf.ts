/**
 * CSRF double-submit helpers for per-subdomain tokens.
 * Each cell sets its own csrf cookie (not HttpOnly) and validates X-CSRF-Token header.
 */

function getCookieValueFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    return value || null;
  }
  return null;
}

/**
 * Generate a cryptographically random CSRF token (32 bytes as hex string).
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Get CSRF token value from request Cookie header.
 */
export function getCsrfFromRequest(
  request: Request,
  options: { cookieName: string }
): string | null {
  const cookieHeader = request.headers.get("Cookie");
  return getCookieValueFromHeader(cookieHeader, options.cookieName);
}

export type ValidateCsrfOptions = {
  cookieName: string;
  headerName?: string;
};

const DEFAULT_CSRF_HEADER = "X-CSRF-Token";

/**
 * Validate that the request has matching non-empty cookie and header values.
 */
export function validateCsrf(
  request: Request,
  options: ValidateCsrfOptions
): boolean {
  const headerName = options.headerName ?? DEFAULT_CSRF_HEADER;
  const cookieVal = getCsrfFromRequest(request, { cookieName: options.cookieName });
  const headerVal = request.headers.get(headerName)?.trim() ?? null;
  if (!cookieVal || !headerVal) return false;
  return cookieVal === headerVal;
}

export type BuildCsrfCookieOptions = {
  cookieName: string;
  secure?: boolean;
  sameSite?: "Strict" | "Lax";
};

/**
 * Build Set-Cookie value for CSRF token. Not HttpOnly so frontend can read and send in header.
 */
export function buildCsrfCookieHeader(
  value: string,
  options: BuildCsrfCookieOptions
): string {
  const sameSite = options.sameSite ?? "Strict";
  const parts = [`${options.cookieName}=${value}`, "Path=/", `SameSite=${sameSite}`];
  if (options.secure === true) parts.push("Secure");
  return parts.join("; ");
}
