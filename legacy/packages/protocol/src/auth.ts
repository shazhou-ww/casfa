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
