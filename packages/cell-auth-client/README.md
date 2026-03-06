# @casfa/cell-auth-client

Auth client for **CLI / non-browser**: token storage (e.g. localStorage or set by OAuth flow), requests send **Authorization: Bearer**. No cookie, no CSRF.

- **createAuthClient**: `storagePrefix`; getAuth/setTokens from storage; logout clears local.
- **createApiFetch**: adds Bearer from getAuth(); on 401 calls onUnauthorized.

For **browser frontends** with SSO cookie + CSRF, use `@casfa/cell-auth-webui` instead.
