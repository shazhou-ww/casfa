/**
 * Helpers for SSO and business cells: read JWT from cookie or Authorization header,
 * build Set-Cookie header values (HttpOnly). SSO uses build*CookieHeader; business
 * cells use getTokenFromRequest (cookie-only).
 */

/**
 * Get bearer token from request: Authorization Bearer first, then cookie if
 * cookieName is set. Returns null if neither present or cookieName omitted.
 * When cookieOnly is true, only the Cookie header is read (no Authorization).
 */
export function getTokenFromRequest(
  request: Request,
  options: { cookieName?: string; cookieOnly?: boolean }
): string | null {
  if (!options.cookieOnly) {
    const auth = request.headers.get("Authorization") ?? request.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7).trim() || null;
    }
  }
  if (!options.cookieName) return null;
  return getCookieFromRequest(request, options.cookieName);
}

/**
 * Get a cookie value from request by name. Only reads Cookie header (no Authorization).
 */
export function getCookieFromRequest(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== cookieName) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    return value || null;
  }
  return null;
}

export type BuildAuthCookieOptions = {
  cookieName: string;
  cookieDomain?: string;
  cookiePath?: string;
  cookieMaxAgeSeconds?: number;
  secure?: boolean;
  sameSite?: "Strict" | "Lax";
};

export function buildAuthCookieHeader(token: string, options: BuildAuthCookieOptions): string {
  const path = options.cookiePath ?? "/";
  const sameSite = options.sameSite ?? "Strict";
  const parts = [`${options.cookieName}=${token}`, `Path=${path}`, "HttpOnly", `SameSite=${sameSite}`];
  if (options.cookieDomain) parts.push(`Domain=${options.cookieDomain}`);
  if (options.cookieMaxAgeSeconds != null) parts.push(`Max-Age=${options.cookieMaxAgeSeconds}`);
  if (options.secure === true) parts.push("Secure");
  return parts.join("; ");
}

export type BuildClearAuthCookieOptions = {
  cookieName: string;
  cookiePath?: string;
  cookieDomain?: string;
  sameSite?: "Strict" | "Lax";
};

export function buildClearAuthCookieHeader(options: BuildClearAuthCookieOptions): string {
  const path = options.cookiePath ?? "/";
  const sameSite = options.sameSite ?? "Strict";
  const parts = [`${options.cookieName}=`, `Path=${path}`, "Max-Age=0", "HttpOnly", `SameSite=${sameSite}`];
  if (options.cookieDomain) parts.push(`Domain=${options.cookieDomain}`);
  return parts.join("; ");
}

export type BuildRefreshCookieOptions = {
  cookieName: string;
  cookieDomain?: string;
  cookiePath?: string;
  cookieMaxAgeSeconds?: number;
  secure?: boolean;
  sameSite?: "Strict" | "Lax";
};

export function buildRefreshCookieHeader(token: string, options: BuildRefreshCookieOptions): string {
  const path = options.cookiePath ?? "/oauth/refresh";
  const sameSite = options.sameSite ?? "Strict";
  const parts = [`${options.cookieName}=${token}`, `Path=${path}`, "HttpOnly", `SameSite=${sameSite}`];
  if (options.cookieDomain) parts.push(`Domain=${options.cookieDomain}`);
  if (options.cookieMaxAgeSeconds != null) parts.push(`Max-Age=${options.cookieMaxAgeSeconds}`);
  if (options.secure === true) parts.push("Secure");
  return parts.join("; ");
}

export type BuildClearRefreshCookieOptions = {
  cookieName: string;
  cookiePath?: string;
  cookieDomain?: string;
  sameSite?: "Strict" | "Lax";
};

export function buildClearRefreshCookieHeader(
  options: BuildClearRefreshCookieOptions
): string {
  const path = options.cookiePath ?? "/oauth/refresh";
  const sameSite = options.sameSite ?? "Strict";
  const parts = [`${options.cookieName}=`, `Path=${path}`, "Max-Age=0", "HttpOnly", `SameSite=${sameSite}`];
  if (options.cookieDomain) parts.push(`Domain=${options.cookieDomain}`);
  return parts.join("; ");
}
