# @casfa/cell-auth-webui

Frontend auth for business cell apps: cookie-only. No token in localStorage.

- **createAuthClient**: SSO logout only; `getAuth()` always returns `null` (user from `/api/me`).
- **createApiFetch**: `credentials: "include"`, `X-CSRF-Token` from cookie, 401 → POST SSO `/oauth/refresh` then retry.

Use in browser frontends that talk to a business cell behind SSO (cookie + CSRF). For CLI or non-browser clients, use `@casfa/cell-auth-client` (Bearer token).
