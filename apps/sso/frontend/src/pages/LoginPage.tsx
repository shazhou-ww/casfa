import { useSearchParams } from "react-router-dom";
import { CognitoLoginCard } from "@casfa/cell-cognito-webui";

/**
 * SSO login page: Cognito only. Uses shared CognitoLoginCard from cell-cognito-webui.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("return_url") ?? "";

  return (
    <CognitoLoginCard
      authorizePath="/oauth/authorize"
      returnUrl={returnUrl || undefined}
      title="CASFA"
      subtitle="Content-Addressable Storage for Agents"
    />
  );
}
