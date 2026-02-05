/**
 * Delegate Token 相关类型定义
 *
 * 基于 docs/delegate-token-refactor/impl/01-dynamodb-changes.md
 */

// ============================================================================
// Token Types
// ============================================================================

/**
 * Delegate Token 数据库记录
 *
 * 注意：不存储完整 tokenBytes，只存储元数据
 * Token 通过 HTTPS 返回给客户端保管
 */
export type DelegateTokenRecord = {
  // 主键
  pk: string; // TOKEN#{tokenId}
  sk: string; // METADATA

  // Token 基本信息
  tokenId: string; // dlt1_xxx 格式
  tokenType: "delegate" | "access";
  realm: string; // 32 bytes hash 的 hex 表示
  expiresAt: number; // Unix epoch ms
  depth: number; // Token 深度 (0-15)

  // Token 标识信息
  name?: string; // Token 名称
  description?: string; // Token 描述

  // 签发信息
  issuerId: string; // 签发者 ID (hex)
  issuerType: "user" | "token";
  parentTokenId?: string; // 转签发时的父 Token ID
  issuerChain: string[]; // 预计算的签发链

  // 权限标志
  canUpload: boolean;
  canManageDepot: boolean;
  isUserIssued: boolean;

  // Scope 信息（二选一，互斥）
  // 不变式：必须且仅有一个非空
  scopeNodeHash?: string; // 单 scope 时的节点 hash (hex)，直接指向单个 CAS 节点
  scopeSetNodeId?: string; // 多 scope 或 empty-set 时的 set-node ID，指向 ScopeSetNode 记录

  // 状态
  isRevoked: boolean;
  revokedAt?: number;
  revokedBy?: string;

  // 时间戳
  createdAt: number;

  // TTL（DynamoDB 自动删除）
  ttl: number; // Unix epoch 秒，= expiresAt / 1000

  // GSI 键
  gsi1pk: string; // REALM#{realm}
  gsi1sk: string; // TOKEN#{tokenId}
  gsi2pk: string; // ISSUER#{issuerId}
  gsi2sk: string; // TOKEN#{tokenId}
};

/**
 * 创建 DelegateToken 时的输入类型（不包含自动生成的字段）
 */
export type CreateDelegateTokenInput = Omit<
  DelegateTokenRecord,
  "pk" | "sk" | "gsi1pk" | "gsi1sk" | "gsi2pk" | "gsi2sk" | "ttl" | "isRevoked" | "createdAt"
>;

// ============================================================================
// Ticket Types
// ============================================================================

/**
 * Ticket 工作空间记录
 *
 * 简化设计：权限由关联的 Access Token 承载
 * 主键设计：使用 REALM#{realm} 分区，可直接按 realm 查询，无需 GSI
 *
 * 注意：expiresAt 不存储在 Ticket 中，查询时从关联的 Access Token 获取
 */
export type TicketRecord = {
  // 主键
  pk: string; // REALM#{realm}
  sk: string; // TICKET#{ticketId}

  // 基本信息
  ticketId: string;
  realm: string;
  title: string;

  // 工作空间状态
  status: "pending" | "submitted";
  submittedAt?: number;

  // Submit 输出
  root?: string; // submit 的输出节点 hash

  // 关联的 Access Token
  accessTokenId: string;

  // 创建信息
  creatorTokenId: string; // 创建该 Ticket 的再授权 Token ID

  // 时间戳
  createdAt: number;

  // TTL（DynamoDB 自动删除）
  ttl: number; // Unix epoch 秒，= createdAt / 1000 + 86400（24 小时超时）
};

/**
 * 创建 Ticket 时的输入类型
 */
export type CreateTicketInput = Omit<TicketRecord, "pk" | "sk" | "ttl" | "status" | "createdAt">;

// ============================================================================
// ScopeSetNode Types
// ============================================================================

/**
 * Scope Set-Node 记录
 *
 * 存储 Token scope 的 set-node，带引用计数
 */
export type ScopeSetNodeRecord = {
  // 主键
  pk: string; // SETNODE#{setNodeId}
  sk: string; // METADATA

  // set-node 数据
  setNodeId: string; // Blake3-128 hash of children (hex)
  children: string[]; // 子节点 hash 列表（已排序去重，hex）

  // 引用计数
  refCount: number; // 引用此 set-node 的 Token 数量

  // 时间戳
  createdAt: number;
  lastUpdated: number;
};

// ============================================================================
// TokenRequest Types
// ============================================================================

/**
 * 客户端授权申请记录
 *
 * 替代现有的 ClientPending
 */
export type TokenRequestRecord = {
  // 主键
  pk: string; // TOKENREQ#{requestId}
  sk: string; // METADATA

  // 申请信息
  requestId: string;
  clientName: string;
  clientSecretHash: string; // Blake3-256 hash of clientSecret

  // 申请状态
  status: "pending" | "approved" | "rejected" | "expired";

  // 批准后的配置
  realm?: string;
  tokenType?: "delegate" | "access";
  depth?: number; // 申请的 Token 深度 (0-15)
  expiresIn?: number; // Token 有效期（秒）
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[]; // scope 节点列表

  // Token 元数据
  tokenName?: string; // Token 名称
  tokenDescription?: string; // Token 描述

  // 加密的 Token（批准后设置）
  encryptedToken?: string;

  // 时间戳
  createdAt: number;
  expiresAt: number; // 申请的过期时间（毫秒）
  approvedAt?: number;
  approvedBy?: string; // 批准者的用户 ID
  approverTokenId?: string; // 批准者使用的 Token ID（若通过 Token 批准）

  // TTL（DynamoDB 自动删除）
  ttl: number; // Unix epoch 秒，= expiresAt / 1000
};

/**
 * 创建 TokenRequest 时的输入类型
 */
export type CreateTokenRequestInput = Omit<
  TokenRequestRecord,
  "pk" | "sk" | "ttl" | "status" | "createdAt" | "expiresAt"
> & {
  expiresIn?: number; // 申请有效期（秒），默认 5 分钟
};

/**
 * 批准 TokenRequest 时的配置
 */
export type ApproveTokenRequestConfig = {
  realm: string;
  tokenType: "delegate" | "access";
  depth?: number;
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope?: string[];
  tokenName?: string;
  tokenDescription?: string;
};

// ============================================================================
// TokenAudit Types
// ============================================================================

/**
 * Token 审计日志操作类型
 */
export type TokenAuditAction = "create" | "revoke" | "delegate" | "use";

/**
 * Token 审计日志执行者类型
 */
export type TokenAuditActorType = "user" | "token" | "system";

/**
 * Token 审计日志记录
 */
export type TokenAuditRecord = {
  // 主键
  pk: string; // AUDIT#{tokenId}
  sk: string; // {timestamp}#{action}

  // 审计信息
  tokenId: string;
  action: TokenAuditAction;
  actorId: string; // 执行操作的身份 ID
  actorType: TokenAuditActorType;
  timestamp: number;

  // 操作详情
  details?: {
    childTokenId?: string; // delegate 操作产生的子 Token
    resourceType?: string; // use 操作的资源类型
    resourceId?: string; // use 操作的资源 ID
    reason?: string; // revoke 操作的原因
  };

  // GSI 键
  gsi4pk: string; // AUDIT_DATE#{date}
  gsi4sk: string; // {timestamp}#{tokenId}

  // TTL（DynamoDB 自动删除）
  ttl: number; // Unix epoch 秒，= timestamp / 1000 + 90 * 86400（90 天保留期）
};

/**
 * 创建审计日志时的输入类型
 */
export type CreateTokenAuditInput = Omit<
  TokenAuditRecord,
  "pk" | "sk" | "gsi4pk" | "gsi4sk" | "ttl" | "timestamp"
>;

// ============================================================================
// UserQuota Types
// ============================================================================

/**
 * 用户配额记录
 *
 * 存储用户级别的配额限制和使用量统计
 */
export type UserQuotaRecord = {
  // 主键
  pk: string; // QUOTA#{realm}
  sk: string; // USER

  // 用户信息
  realm: string; // realm (userId hash)

  // 配额设置
  quotaLimit: number; // 总配额（字节）

  // 存储使用量
  bytesUsed: number; // 已提交的存储使用量
  bytesInProgress: number; // 进行中的 Ticket 占用（预扣）

  // 资源计数
  tokenCount: number; // 当前有效 Token 数量
  depotCount: number; // 当前 Depot 数量
  ticketCount: number; // 当前活跃 Ticket 数量

  // 时间戳
  createdAt: number;
  lastUpdated: number;
};

// ============================================================================
// TokenUsage Types (Reserved)
// ============================================================================

/**
 * Token 使用量记录（Reserved，当前版本不启用）
 */
export type TokenUsageRecord = {
  // 主键
  pk: string; // USAGE#{tokenId}
  sk: string; // AGGREGATE

  // 使用量
  bytesUsed: number;
  lastUpdated: number;
};

// ============================================================================
// Depot Types (Extended)
// ============================================================================

/**
 * Depot 数据库记录
 *
 * 主键设计：使用 REALM#{realm} 分区，可直接按 realm 查询，无需 GSI
 */
export type DepotRecord = {
  // 主键
  pk: string; // REALM#{realm}
  sk: string; // DEPOT#{depotId}

  // 基本信息
  realm: string;
  depotId: string;
  name: string; // Depot 名称（与 API 响应一致）

  // 版本信息
  root: string; // 当前根节点 hash
  maxHistory: number;
  history: string[]; // 历史根节点列表

  // 创建者追踪
  creatorIssuerId: string; // 创建该 Depot 的 Token 的 issuer ID
  creatorTokenId: string; // 创建该 Depot 的 Token ID

  // 时间戳
  createdAt: number;
  updatedAt: number;

  // GSI 键（仅用于按创建者查询）
  gsi3pk: string; // CREATOR#{creatorIssuerId}
  gsi3sk: string; // DEPOT#{depotId}
};

/**
 * 创建 Depot 时的输入类型
 */
export type CreateDepotInput = Omit<
  DepotRecord,
  "pk" | "sk" | "gsi3pk" | "gsi3sk" | "createdAt" | "updatedAt" | "history"
>;

// ============================================================================
// Common Types
// ============================================================================

/**
 * 分页查询选项
 */
export type ListOptions = {
  limit?: number;
  cursor?: string;
};

/**
 * 分页查询结果
 */
export type PaginatedResult<T> = {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
};
