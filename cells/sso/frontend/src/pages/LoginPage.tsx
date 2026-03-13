import { useSearchParams } from "react-router-dom";
import { CognitoLoginCard } from "@casfa/cell-cognito-webui";

/**
 * SSO login page: Cognito only. Uses shared CognitoLoginCard from cell-cognito-webui.
 */
function withMountPath(path: string): string {
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  const base = seg ? `/${seg}` : "";
  if (!base) return path;
  return path.startsWith(base + "/") ? path : `${base}${path}`;
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("return_url") ?? "";

  return (
    <CognitoLoginCard
      authorizePath={withMountPath("/oauth/authorize")}
      returnUrl={returnUrl || undefined}
      title="CASFA"
      subtitle="Content-Addressable Storage for Agents"
    />
  );
}
