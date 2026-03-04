import type { Auth } from "@casfa/cell-oauth";

declare module "hono" {
  interface ContextVariableMap {
    auth: Auth | null;
  }
}
