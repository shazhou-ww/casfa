import { useMutation, useQuery } from "@tanstack/react-query";
import { tokenRequestsApi } from "../api/token-requests";
import type { TokenRequestApproveParams } from "../api/types";

export function useTokenRequest(requestId: string | null) {
  return useQuery({
    queryKey: ["token-requests", requestId],
    queryFn: () => tokenRequestsApi.get(requestId!),
    enabled: !!requestId,
    refetchInterval: false,
  });
}

export function useApproveRequest() {
  return useMutation({
    mutationFn: (params: { requestId: string } & TokenRequestApproveParams) => {
      const { requestId, ...approveParams } = params;
      return tokenRequestsApi.approve(requestId, approveParams);
    },
  });
}

export function useRejectRequest() {
  return useMutation({
    mutationFn: (requestId: string) => tokenRequestsApi.reject(requestId),
  });
}
