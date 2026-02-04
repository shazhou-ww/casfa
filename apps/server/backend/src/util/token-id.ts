/**
 * Token ID utilities
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a random token ID
 */
export const generateTokenId = (prefix = "tok"): string => {
  const bytes = randomBytes(16);
  const hex = bytes.toString("hex");
  return `${prefix}_${hex}`;
};

/**
 * Extract token ID from primary key
 * pk format: "token#{id}" -> returns "{id}"
 */
export const extractTokenId = (pk: string): string => {
  if (pk.startsWith("token#")) {
    return pk.slice(6);
  }
  return pk;
};

/**
 * Create primary key from token ID
 */
export const toTokenPk = (tokenId: string): string => {
  return `token#${tokenId}`;
};

/**
 * Generate a ticket ID
 */
export const generateTicketId = (): string => generateTokenId("tkt");

/**
 * Generate an agent token ID
 */
export const generateAgentTokenId = (): string => generateTokenId("agt");

/**
 * Generate a depot ID
 */
export const generateDepotId = (): string => generateTokenId("dpt");
