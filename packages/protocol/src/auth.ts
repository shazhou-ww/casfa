/**
 * Auth API schemas
 */

import { z } from "zod";

// ============================================================================
// OAuth Schemas
// ============================================================================

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type Login = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type Refresh = z.infer<typeof RefreshSchema>;

export const TokenExchangeSchema = z.object({
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  /** PKCE code verifier for public clients */
  code_verifier: z.string().min(43).max(128).optional(),
});

export type TokenExchange = z.infer<typeof TokenExchangeSchema>;

// ============================================================================
// Client Auth Schemas (P256 public key authentication)
// ============================================================================

export const ClientInitSchema = z.object({
  pubkey: z.string().min(1),
  clientName: z.string().min(1),
});

export type ClientInit = z.infer<typeof ClientInitSchema>;

export const ClientCompleteSchema = z.object({
  clientId: z.string().min(1),
  verificationCode: z.string().min(1),
});

export type ClientComplete = z.infer<typeof ClientCompleteSchema>;

// ============================================================================
// Ticket Schemas
// ============================================================================

/**
 * Writable configuration for ticket
 */
export const WritableConfigSchema = z.object({
  quota: z.number().positive().optional(),
  accept: z.array(z.string()).optional(),
});

export type WritableConfig = z.infer<typeof WritableConfigSchema>;

/**
 * Schema for POST /api/realm/{realmId}/tickets
 * Create a new ticket with input scope, purpose, and optional write access
 */
export const CreateTicketSchema = z.object({
  /** Input node keys defining readable scope. Omit for full read access */
  input: z.array(z.string()).optional(),
  /** Human-readable task description */
  purpose: z.string().max(500).optional(),
  /** Write permission config. Omit for read-only ticket */
  writable: WritableConfigSchema.optional(),
  /** Expiration time in seconds, default 24 hours */
  expiresIn: z.number().positive().optional(),
});

export type CreateTicket = z.infer<typeof CreateTicketSchema>;

// ============================================================================
// Token Schemas (API access tokens)
// ============================================================================

/**
 * Schema for POST /api/auth/tokens
 * Create a new API Token
 */
export const CreateTokenSchema = z.object({
  /** Token name (required) */
  name: z.string().min(1).max(100),
  /** Optional description */
  description: z.string().max(500).optional(),
  /** Expiration time in seconds, default 30 days */
  expiresIn: z.number().positive().optional(),
});

export type CreateToken = z.infer<typeof CreateTokenSchema>;
