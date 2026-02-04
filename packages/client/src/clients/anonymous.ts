/**
 * Anonymous client - the entry point for CASFA client.
 *
 * This client provides:
 * - Public APIs (no auth required)
 * - Methods to upgrade to authenticated clients
 */

import type { P256KeyPair } from "../types/providers.ts";
import { createBaseClientApi, createBaseContext } from "./base.ts";
import { createDelegateClient } from "./delegate.ts";
import { createTicketClient } from "./ticket.ts";
import type {
  CasfaAnonymousClient,
  CasfaDelegateClient,
  CasfaTicketClient,
  CasfaUserClient,
  ClientConfig,
} from "./types.ts";
import { createUserClient } from "./user.ts";

/**
 * Create an anonymous CASFA client.
 *
 * This is the main entry point for the client library.
 * Use the `with*` methods to create authenticated clients.
 *
 * @example
 * ```typescript
 * // Create anonymous client
 * const client = createCasfaClient({ baseUrl: "https://api.casfa.io" });
 *
 * // Get service info (public)
 * const info = await client.getInfo();
 *
 * // Upgrade to ticket client
 * const ticketClient = client.withTicket("ticket-id", "realm-id");
 * await ticketClient.nodes.get("sha256:abc...");
 *
 * // Upgrade to user client
 * const userClient = client.withUserToken(accessToken);
 * await userClient.agentTokens.create({ name: "my-agent" });
 *
 * // Upgrade to delegate client (for agents)
 * const agentClient = client.withDelegateToken("casfa_xxx...");
 * const realm = agentClient.withRealm("realm-id");
 * await realm.tickets.create({ purpose: "test" });
 * ```
 */
export const createCasfaClient = (config: ClientConfig): CasfaAnonymousClient => {
  const ctx = createBaseContext(config);
  const baseClient = createBaseClientApi(ctx);

  return {
    ...baseClient,

    withTicket: (ticketId: string, realmId: string): CasfaTicketClient => {
      return createTicketClient({
        ...config,
        ticketId,
        realmId,
      });
    },

    withUserToken: (accessToken: string, refreshToken?: string): CasfaUserClient => {
      return createUserClient({
        ...config,
        accessToken,
        refreshToken,
      });
    },

    withDelegateToken: (token: string): CasfaDelegateClient => {
      return createDelegateClient({
        ...config,
        authType: "token",
        token,
      });
    },

    withDelegateKeys: (keyPair: P256KeyPair): CasfaDelegateClient => {
      return createDelegateClient({
        ...config,
        authType: "p256",
        keyPair,
      });
    },
  };
};
