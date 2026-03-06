# @casfa/cell-auth-server

Server-side auth for **business cells** and **SSO cell**: cookie read/build/clear, CSRF issue and validate.

- **getTokenFromRequest** / **getCookieFromRequest**: Read token or cookie from request (cookie-only mode for business cells).
- **buildAuthCookieHeader** / **buildRefreshCookieHeader** / **buildClear***: Build Set-Cookie values (SSO and business cells).
- **generateCsrfToken** / **buildCsrfCookieHeader** / **getCsrfFromRequest** / **validateCsrf**: Per-subdomain CSRF double-submit.

Business cell backend: use `getTokenFromRequest(..., { cookieName, cookieOnly: true })`, verify JWT, then `validateCsrf` for write requests. SSO cell: use build*CookieHeader for auth/refresh cookies. Both can depend on `@casfa/cell-auth-server`.
