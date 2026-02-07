import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tokensApi } from "../api/tokens";

export function useTokenList() {
  return useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const res = await tokensApi.list();
      return res.tokens;
    },
  });
}

export function useTokenDetail(tokenId: string | null) {
  return useQuery({
    queryKey: ["tokens", tokenId],
    queryFn: () => tokensApi.get(tokenId!),
    enabled: !!tokenId,
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      realm: string;
      name: string;
      type: "delegate" | "access";
      expiresIn?: number;
      canUpload?: boolean;
      canManageDepot?: boolean;
      scope?: string[];
    }) => tokensApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => tokensApi.revoke(tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });
}
