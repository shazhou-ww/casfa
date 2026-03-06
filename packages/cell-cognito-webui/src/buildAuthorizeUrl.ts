/**
 * Build the SSO authorize URL for Cognito login (same-origin to SSO cell).
 * Used by CognitoLoginCard and SSO frontends.
 */
export function buildCognitoLoginAuthorizeUrl(params: {
  /** Base path for authorize (e.g. "/oauth/authorize"). */
  authorizePath: string;
  /** Return URL after login (optional). */
  returnUrl?: string;
  /** Identity provider (e.g. "Google", "Microsoft"). */
  identityProvider: string;
  /** Scope (default openid email profile). */
  scope?: string;
}): string {
  const search = new URLSearchParams({
    scope: params.scope ?? "openid email profile",
    identity_provider: params.identityProvider,
  });
  if (params.returnUrl) search.set("return_url", params.returnUrl);
  const path = params.authorizePath.replace(/\/$/, "");
  return `${path}?${search.toString()}`;
}
