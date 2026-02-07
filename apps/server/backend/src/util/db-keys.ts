/**
 * DynamoDB 键值计算工具函数
 *
 * 基于 docs/delegate-token-refactor/impl/01-dynamodb-changes.md
 */

// ============================================================================
// Token Keys
// ============================================================================

/** Token 主键 */
export const toTokenPk = (tokenId: string): string => `TOKEN#${tokenId}`;

/** Token 排序键 */
export const toTokenSk = (): string => "METADATA";

/** 从 Token PK 提取 tokenId */
export const extractTokenId = (pk: string): string => {
  if (pk.startsWith("TOKEN#")) {
    return pk.slice(6);
  }
  return pk;
};

// ============================================================================
// Realm Keys (用于 Depot 和 Ticket)
// ============================================================================

/** Realm 主键（用于 Depot 和 Ticket） */
export const toRealmPk = (realm: string): string => `REALM#${realm}`;

/** Depot 排序键 */
export const toDepotSk = (depotId: string): string => `DEPOT#${depotId}`;

/** Ticket 排序键 */
export const toTicketSk = (ticketId: string): string => `TICKET#${ticketId}`;

/** 从 Depot SK 提取 depotId */
export const extractDepotId = (sk: string): string => {
  if (sk.startsWith("DEPOT#")) {
    return sk.slice(6);
  }
  return sk;
};

/** 从 Ticket SK 提取 ticketId */
export const extractTicketId = (sk: string): string => {
  if (sk.startsWith("TICKET#")) {
    return sk.slice(7);
  }
  return sk;
};

// ============================================================================
// ScopeSetNode Keys
// ============================================================================

/** ScopeSetNode 主键 */
export const toSetNodePk = (setNodeId: string): string => `SETNODE#${setNodeId}`;

/** ScopeSetNode 排序键 */
export const toSetNodeSk = (): string => "METADATA";

// ============================================================================
// TokenRequest Keys
// ============================================================================

/** TokenRequest 主键 */
export const toTokenReqPk = (requestId: string): string => `TOKENREQ#${requestId}`;

/** TokenRequest 排序键 */
export const toTokenReqSk = (): string => "METADATA";

// ============================================================================
// Audit Keys
// ============================================================================

/** Audit 主键 */
export const toAuditPk = (tokenId: string): string => `AUDIT#${tokenId}`;

/** Audit 排序键（使用零填充的 13 位时间戳确保正确排序） */
export const toAuditSk = (timestamp: number, action: string): string =>
  `${timestamp.toString().padStart(13, "0")}#${action}`;

/** 日期格式化（用于 gsi4pk） */
export const toAuditDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
};

/** Audit GSI4 主键 */
export const toAuditGsi4Pk = (date: string): string => `AUDIT_DATE#${date}`;

/** Audit GSI4 排序键 */
export const toAuditGsi4Sk = (timestamp: number, tokenId: string): string =>
  `${timestamp.toString().padStart(13, "0")}#${tokenId}`;

// ============================================================================
// UserQuota Keys
// ============================================================================

/** UserQuota 主键 */
export const toQuotaPk = (realm: string): string => `QUOTA#${realm}`;

/** UserQuota 排序键 */
export const toQuotaSk = (): string => "USER";

// ============================================================================
// TokenUsage Keys (Reserved)
// ============================================================================

/** TokenUsage 主键 */
export const toUsagePk = (tokenId: string): string => `USAGE#${tokenId}`;

/** TokenUsage 排序键 */
export const toUsageSk = (): string => "AGGREGATE";

// ============================================================================
// GSI Keys
// ============================================================================

/** GSI1: Realm Index - 用于按 realm 查询 Token */
export const toRealmGsi1Pk = (realm: string): string => `REALM#${realm}`;
export const toTokenGsi1Sk = (tokenId: string): string => `TOKEN#${tokenId}`;

/** GSI2: Issuer Index - 用于按签发者查询子 Token（级联撤销） */
export const toIssuerGsi2Pk = (issuerId: string): string => `ISSUER#${issuerId}`;
export const toTokenGsi2Sk = (tokenId: string): string => `TOKEN#${tokenId}`;

/** GSI3: Creator Index - 用于按创建者查询 Depot */
export const toCreatorGsi3Pk = (creatorIssuerId: string): string => `CREATOR#${creatorIssuerId}`;
export const toDepotGsi3Sk = (depotId: string): string => `DEPOT#${depotId}`;

// ============================================================================
// TTL Helpers
// ============================================================================

/** 将毫秒时间戳转换为 TTL（Unix epoch 秒） */
export const toTtl = (expiresAtMs: number): number => Math.floor(expiresAtMs / 1000);

/** 计算 Ticket TTL（创建时间 + 24 小时） */
export const toTicketTtl = (createdAtMs: number): number => Math.floor(createdAtMs / 1000) + 86400; // 24 hours

/** 计算审计日志 TTL（时间戳 + 90 天） */
export const toAuditTtl = (timestampMs: number): number =>
  Math.floor(timestampMs / 1000) + 90 * 86400; // 90 days

// ============================================================================
// Cursor Encoding
// ============================================================================

/** 编码游标 */
export const encodeCursor = (lastEvaluatedKey: Record<string, unknown>): string => {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64");
};

/** 解码游标 */
export const decodeCursor = (cursor: string): Record<string, unknown> => {
  return JSON.parse(Buffer.from(cursor, "base64").toString()) as Record<string, unknown>;
};
