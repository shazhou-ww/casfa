/**
 * CASFA v2 - Type Definitions
 *
 * All types use `type` instead of `interface` for consistency.
 */

import type { NodeKind as CasNodeKind } from "@casfa/core";
import type { Context } from "hono";

// Re-export NodeKind from cas-core
export type NodeKind = CasNodeKind;

// ============================================================================
// CAS Content Types and Metadata Keys
// ============================================================================

export const CAS_CONTENT_TYPES = {
  CHUNK: "application/octet-stream",
  INLINE_FILE: "application/vnd.cas.inline-file",
  FILE: "application/vnd.cas.file",
  COLLECTION: "application/vnd.cas.collection",
} as const;

export type CasContentType = (typeof CAS_CONTENT_TYPES)[keyof typeof CAS_CONTENT_TYPES];

export const CAS_HEADERS = {
  CONTENT_TYPE: "X-CAS-Content-Type",
  SIZE: "X-CAS-Size",
  KIND: "X-CAS-Kind",
} as const;

// ============================================================================
// User Role
// ============================================================================

export type UserRole = "unauthorized" | "authorized" | "admin";

// ============================================================================
// Auth Context (Delegate Token Model)
// ============================================================================

import type { DelegateTokenRecord } from "./types/delegate-token.ts";

/**
 * 认证上下文基础类型
 */
type BaseAuthContext = {
  realm: string;
};

/**
 * JWT 认证上下文（用户登录）
 */
export type JwtAuthContext = BaseAuthContext & {
  type: "jwt";
  userId: string;
  email?: string;
  name?: string;
  role: UserRole;
  expiresAt: number;
};

/**
 * Delegate Token 认证上下文（再授权 Token）
 *
 * Delegate Token 只能用于签发子 Token，不能直接访问数据
 */
export type DelegateTokenAuthContext = BaseAuthContext & {
  type: "delegate";
  tokenId: string;
  tokenBytes: Uint8Array;
  tokenRecord: DelegateTokenRecord;
  canUpload: boolean;
  canManageDepot: boolean;
  depth: number;
  issuerChain: string[];
};

/**
 * Access Token 认证上下文（访问 Token）
 *
 * Access Token 可以访问数据但不能转签发
 */
export type AccessTokenAuthContext = BaseAuthContext & {
  type: "access";
  tokenId: string;
  tokenBytes: Uint8Array;
  tokenRecord: DelegateTokenRecord;
  canUpload: boolean;
  canManageDepot: boolean;
  issuerChain: string[];
};

/**
 * Token 认证上下文联合类型
 */
export type TokenAuthContext = DelegateTokenAuthContext | AccessTokenAuthContext;

/**
 * 所有认证上下文联合类型
 */
export type AuthContext = JwtAuthContext | TokenAuthContext;

/**
 * Scope 验证结果
 */
export type ScopeVerificationResult = {
  valid: boolean;
  reason?: string;
  verifiedPath?: number[];
};

// ============================================================================
// Auth Context Type Guards
// ============================================================================

/**
 * 类型守卫：检查是否为 JWT 认证
 */
export function isJwtAuth(auth: AuthContext): auth is JwtAuthContext {
  return auth.type === "jwt";
}

/**
 * 类型守卫：检查是否为 Delegate Token 认证
 */
export function isDelegateTokenAuth(auth: AuthContext): auth is DelegateTokenAuthContext {
  return auth.type === "delegate";
}

/**
 * 类型守卫：检查是否为 Access Token 认证
 */
export function isAccessTokenAuth(auth: AuthContext): auth is AccessTokenAuthContext {
  return auth.type === "access";
}

/**
 * 类型守卫：检查是否为 Token 认证（Delegate 或 Access）
 */
export function isTokenAuth(auth: AuthContext): auth is TokenAuthContext {
  return auth.type === "delegate" || auth.type === "access";
}

// ============================================================================
// CAS Types
// ============================================================================

export type GcStatus = "active" | "pending";

export type CasOwnership = {
  realm: string;
  key: string;
  kind?: NodeKind;
  createdAt: number;
  /** Delegate Token ID or User ID that owns this node */
  ownerId: string;
  contentType?: string;
  size: number;
};

export type RefCount = {
  realm: string;
  key: string;
  count: number;
  physicalSize: number;
  logicalSize: number;
  gcStatus: GcStatus;
  createdAt: number;
};

export type RealmUsage = {
  realm: string;
  physicalBytes: number;
  logicalBytes: number;
  nodeCount: number;
  quotaLimit: number;
  updatedAt: number;
};

// ============================================================================
// Depot Types
// ============================================================================

export type Depot = {
  realm: string;
  depotId: string;
  title: string;
  root: string;
  maxHistory: number;
  history: string[];
  createdAt: number;
  updatedAt: number;
};

// ============================================================================
// API Response Types
// ============================================================================

export type CasEndpointInfo = {
  realm: string;
  scope?: string[];
  commit?: {
    quota?: number;
    accept?: string[];
    root?: string;
  };
  expiresAt?: string;
  nodeLimit: number;
  maxNameBytes: number;
};

export type TreeNodeInfo = {
  kind: NodeKind;
  size: number;
  contentType?: string;
  children?: Record<string, string>;
  chunks?: number;
};

export type TreeResponse = {
  nodes: Record<string, TreeNodeInfo>;
  next?: string;
};

// ============================================================================
// Hono Environment
// ============================================================================

export type Env = {
  Variables: {
    auth: AuthContext;
    scopeVerification?: ScopeVerificationResult;
  };
};

export type AppContext = Context<Env>;
