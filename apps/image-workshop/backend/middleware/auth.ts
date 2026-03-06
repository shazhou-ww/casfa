import type { Auth } from "@casfa/cell-cognito-server";

declare module "hono" {
  interface ContextVariableMap {
    auth?: Auth;
  }
}
