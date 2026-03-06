# @casfa/cell-cognito-webui

SSO frontend shared UI for Cognito login.

- **CognitoLoginCard**: Card with title, subtitle, and Google/Microsoft buttons that link to the SSO authorize URL.
- **buildCognitoLoginAuthorizeUrl**: Build `/oauth/authorize?scope=...&identity_provider=...&return_url=...` for the same-origin SSO cell.

Used by SSO cell frontends (e.g. apps/sso). When multiple SSO endpoints exist, they can all use this package for a consistent login/consent UI.
