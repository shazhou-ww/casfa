/**
 * Helpers for SSO: read JWT from cookie or Authorization header, build Set-Cookie
 * header values (HttpOnly, no JS access). Used by cell backends that share auth
 * across the same parent domain.
 */

/**
 * Get bearer token from request: Authorization Bearer first, then cookie if
 * cookieName is set. Returns null if neither present or cookieName omitted.
 */
export function getTokenFromRequest(
  request: Request,
  options: { cookieName?: string }
): string | null {
  const auth = request.headers.get("Authorization") ?? request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim() || null;
  }
  if (!options.cookieName) return null;
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const name = options.cookieName;
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

export type BuildAuthCookieOptions = {
  cookieName: string;
  cookieDomain?: string;
  cookiePath?: string;
  cookieMaxAgeSeconds?: number;
  secure?: boolean;
  /** Default "Strict". Use "Lax" only if needed for cross-site redirects. */
  sameSite?: "Strict" | "Lax";
};

/**
 * Build a single Set-Cookie header value for the auth token (HttpOnly, SameSite default Strict).
 * Does not include the "Set-Cookie:" prefix. Use for POST /oauth/token response.
 */
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
  /** Must match the cookie that was set. Default "Strict". */
  sameSite?: "Strict" | "Lax";
};

/**
 * Build a Set-Cookie header value that clears the auth cookie (Max-Age=0).
 * Path and Domain must match the cookie that was set so the browser clears it.
 */
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
  /** Default "/oauth/refresh" so cookie is only sent to refresh endpoint. */
  cookiePath?: string;
  cookieMaxAgeSeconds?: number;
  secure?: boolean;
  sameSite?: "Strict" | "Lax";
};

/**
 * Build Set-Cookie value for refresh token (HttpOnly, Path=/oauth/refresh by default).
 */
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

/**
 * Build Set-Cookie value that clears the refresh cookie. Path/Domain must match when set.
 */
export function buildClearRefreshCookieHeader(
  options: BuildClearRefreshCookieOptions
): string {
  const path = options.cookiePath ?? "/oauth/refresh";
  const sameSite = options.sameSite ?? "Strict";
  const parts = [`${options.cookieName}=`, `Path=${path}`, "Max-Age=0", "HttpOnly", `SameSite=${sameSite}`];
  if (options.cookieDomain) parts.push(`Domain=${options.cookieDomain}`);
  return parts.join("; ");
}
