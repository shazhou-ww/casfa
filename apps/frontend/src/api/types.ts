// Auth responses
export type AuthResponse = {
  userId: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type RefreshResponse = {
  accessToken: string;
  expiresIn: number;
};

export type UserInfo = {
  userId: string;
  email?: string;
  name?: string;
  realm: string;
  role: string;
};

// Token types
export type TokenListItem = {
  tokenId: string;
  name: string;
  type: "delegate" | "access";
  realm: string;
  canUpload: boolean;
  canManageDepot: boolean;
  isRevoked: boolean;
  expiresAt: number;
  createdAt: number;
};

export type CreateTokenResponse = {
  tokenId: string;
  tokenBase64: string;
  name: string;
  type: string;
  realm: string;
  expiresAt: number;
};

// Depot types
export type DepotListItem = {
  depotId: string;
  title: string;
  root: string;
  maxHistory: number;
  createdAt: number;
  updatedAt: number;
};

export type DepotDetail = DepotListItem & {
  history: string[];
};

// Filesystem types
export type FsStatResponse = {
  type: "file" | "directory";
  path: string;
  name: string;
  size: number;
  contentType?: string;
  newRoot: string;
};

export type FsLsChild = {
  name: string;
  type: "file" | "directory";
  key: string;
  size?: number;
  contentType?: string;
};

export type FsLsResponse = {
  path: string;
  children: FsLsChild[];
  newRoot: string;
  cursor?: string;
};

export type FsMutationResponse = {
  newRoot: string;
};

// Token request types (client authorization flow)
export type TokenRequestDetail = {
  requestId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  clientName: string;
  displayCode: string;
  createdAt: number;
  expiresAt: number;
};

export type TokenRequestListItem = {
  requestId: string;
  clientName: string;
  status: string;
  createdAt: number;
  expiresAt: number;
};

export type TokenRequestApproveParams = {
  realm: string;
  name: string;
  type: "delegate" | "access";
  expiresIn?: number;
  canUpload?: boolean;
  canManageDepot?: boolean;
  scope: string[];
};

// Pagination
export type PaginatedResponse<T> = {
  items: T[];
  cursor?: string;
};
