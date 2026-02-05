/**
 * Service info schema definitions.
 *
 * Used for the public /api/info endpoint that provides service configuration.
 */

import { z } from "zod";

// ============================================================================
// Enum Schemas
// ============================================================================

export const StorageTypeSchema = z.enum(["memory", "fs", "s3"]);
export type StorageType = z.infer<typeof StorageTypeSchema>;

export const AuthTypeSchema = z.enum(["mock", "cognito", "tokens-only"]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const DatabaseTypeSchema = z.enum(["local", "aws"]);
export type DatabaseType = z.infer<typeof DatabaseTypeSchema>;

// ============================================================================
// Limits Schema
// ============================================================================

export const ServiceLimitsSchema = z.object({
  /** Maximum node/block size in bytes */
  maxNodeSize: z.number().int().positive(),
  /** Maximum name length in bytes */
  maxNameBytes: z.number().int().positive(),
  /** Maximum children in a collection */
  maxCollectionChildren: z.number().int().positive(),
  /** Maximum payload size for uploads in bytes */
  maxPayloadSize: z.number().int().positive(),
  /** Maximum ticket TTL in seconds */
  maxTicketTtl: z.number().int().positive(),
  /** Maximum Delegate Token TTL in seconds */
  maxDelegateTokenTtl: z.number().int().positive(),
  /** Maximum Access Token TTL in seconds */
  maxAccessTokenTtl: z.number().int().positive(),
  /** Maximum token delegation depth (from root user token) */
  maxTokenDepth: z.number().int().positive(),
  /**
   * @deprecated Use maxDelegateTokenTtl instead
   */
  maxAgentTokenTtl: z.number().int().positive().optional(),
});
export type ServiceLimits = z.infer<typeof ServiceLimitsSchema>;

// ============================================================================
// Features Schema
// ============================================================================

export const ServiceFeaturesSchema = z.object({
  /** Whether JWT authentication is enabled (FEATURE_JWT_AUTH) */
  jwtAuth: z.boolean(),
  /** Whether OAuth login is enabled (FEATURE_OAUTH_LOGIN) */
  oauthLogin: z.boolean(),
  /** Whether AWP (Agent Web Portal) auth is enabled (FEATURE_AWP_AUTH) */
  awpAuth: z.boolean(),
});
export type ServiceFeatures = z.infer<typeof ServiceFeaturesSchema>;

// ============================================================================
// Service Info Schema
// ============================================================================

export const ServiceInfoSchema = z.object({
  /** Service name */
  service: z.string(),
  /** Service version */
  version: z.string(),
  /** Storage backend type */
  storage: StorageTypeSchema,
  /** Authentication method */
  auth: AuthTypeSchema,
  /** Database type */
  database: DatabaseTypeSchema,
  /** Server limits */
  limits: ServiceLimitsSchema,
  /** Feature flags (controlled via environment variables) */
  features: ServiceFeaturesSchema,
});
export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;
