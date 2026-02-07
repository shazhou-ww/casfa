import { http } from "./http";
import type { CreateTokenResponse, TokenListItem } from "./types";

export const tokensApi = {
  list: (token?: string) =>
    http.get<{ tokens: TokenListItem[] }>("/api/tokens", token ? { token } : undefined),

  get: (tokenId: string, token?: string) =>
    http.get<TokenListItem>(`/api/tokens/${tokenId}`, token ? { token } : undefined),

  create: (
    data: {
      realm: string;
      name: string;
      type: "delegate" | "access";
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];
    },
    token?: string
  ) => http.post<CreateTokenResponse>("/api/tokens", data, token ? { token } : undefined),

  revoke: (tokenId: string, token?: string) =>
    http.post<{ tokenId: string; revoked: boolean }>(
      `/api/tokens/${tokenId}/revoke`,
      undefined,
      token ? { token } : undefined
    ),

  delegate: (
    data: {
      name: string;
      type: "delegate" | "access";
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];
    },
    delegateToken: string
  ) => http.post<CreateTokenResponse>("/api/tokens/delegate", data, { token: delegateToken }),
};
