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

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

export type Register = z.infer<typeof RegisterSchema>;

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
// Client Auth Schemas (DEPRECATED - use Client Authorization Request instead)
// ============================================================================

/**
 * @deprecated Use CreateAuthRequestSchema from request.ts instead
 * Old P256 public key authentication init schema
 */
export const ClientInitSchema = z.object({
  pubkey: z.string().min(1),
  clientName: z.string().min(1),
});

export type ClientInit = z.infer<typeof ClientInitSchema>;

/**
 * @deprecated Use ApproveRequestSchema from request.ts instead
 * Old client authentication completion schema
 */
export const ClientCompleteSchema = z.object({
  clientId: z.string().min(1),
  verificationCode: z.string().min(1),
});

export type ClientComplete = z.infer<typeof ClientCompleteSchema>;

// ============================================================================
// Ticket Schemas
// ============================================================================

/**
 * @deprecated Use new CreateTicketSchema below
 * Old writable configuration for ticket
 */
export const WritableConfigSchema = z.object({
  quota: z.number().positive().optional(),
  accept: z.array(z.string()).optional(),
});

export type WritableConfig = z.infer<typeof WritableConfigSchema>;

/**
 * Schema for POST /api/realm/{realmId}/tickets
 * Create a new ticket and bind a pre-issued Access Token
 *
 * Note: Requires Access Token authentication
 *
 * Two-step creation flow:
 *   1. Issue Access Token using Delegate Token (POST /api/tokens/delegate)
 *   2. Create Ticket and bind the token (this endpoint)
 */
export const CreateTicketSchema = z.object({
  /** Ticket title (human-readable task description) */
  title: z.string().min(1).max(256),
  /** Pre-issued Access Token ID to bind to this ticket */
  accessTokenId: z.string().min(1),
});

export type CreateTicket = z.infer<typeof CreateTicketSchema>;

// ============================================================================
// Token Schemas (Delegate Token management via User JWT)
// ============================================================================

/**
 * Schema for POST /api/tokens
 * Create a new Delegate Token (requires User JWT authentication)
 */
export const CreateTokenSchema = z.object({
  /** Authorized Realm ID */
  realm: z.string().min(1),
  /** Token name (required) */
  name: z.string().min(1).max(64),
  /** Token type: delegate or access */
  type: z.enum(["delegate", "access"]),
  /** Expiration time in seconds, default 30 days */
  expiresIn: z.number().positive().optional(),
  /** Whether the token can upload nodes */
  canUpload: z.boolean().optional(),
  /** Whether the token can manage depots */
  canManageDepot: z.boolean().optional(),
  /** Authorization scope (CAS URI array, e.g., ["cas://depot:MAIN"]) */
  scope: z.array(z.string()).optional(),
});

export type CreateToken = z.infer<typeof CreateTokenSchema>;
