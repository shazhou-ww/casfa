import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { depotsApi } from "../api/depots";
import type { DepotDetail } from "../api/types";

export function useDepotList(realm: string | null) {
  return useQuery({
    queryKey: ["depots", realm],
    queryFn: async () => {
      const res = await depotsApi.list(realm!);
      return res.depots;
    },
    enabled: !!realm,
  });
}

export function useDepotDetail(realm: string | null, depotId: string | null) {
  return useQuery<DepotDetail>({
    queryKey: ["depots", realm, depotId],
    queryFn: () => depotsApi.get(realm!, depotId!),
    enabled: !!realm && !!depotId,
  });
}

export function useCreateDepot(realm: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; maxHistory?: number }) =>
      depotsApi.create(realm!, data.title, data.maxHistory),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["depots"] }),
  });
}

export function useDeleteDepot(realm: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depotId: string) => depotsApi.delete(realm!, depotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["depots"] }),
  });
}
