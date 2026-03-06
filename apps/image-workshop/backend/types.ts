import type { Auth } from "@casfa/cell-cognito-server";

/** Hono bindings; auth is set by auth middleware from oauthServer.resolveAuth. */
export type Env = {
  Variables: {
    auth?: Auth;
  };
};
