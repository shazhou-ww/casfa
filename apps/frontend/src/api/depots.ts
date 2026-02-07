import { http } from "./http";
import type { DepotDetail, DepotListItem, FsMutationResponse } from "./types";

const getAccessToken = () => localStorage.getItem("casfa_access");

export const depotsApi = {
  list: (realm: string) =>
    http.get<{ depots: DepotListItem[] }>(`/api/realm/${realm}/depots`, {
      token: getAccessToken()!,
    }),

  get: (realm: string, depotId: string) =>
    http.get<DepotDetail>(`/api/realm/${realm}/depots/${depotId}`, { token: getAccessToken()! }),

  create: (realm: string, title: string, maxHistory?: number) =>
    http.post<DepotDetail>(
      `/api/realm/${realm}/depots`,
      { title, maxHistory: maxHistory ?? 20 },
      { token: getAccessToken()! }
    ),

  update: (realm: string, depotId: string, data: { title?: string; maxHistory?: number }) =>
    http.patch<DepotDetail>(`/api/realm/${realm}/depots/${depotId}`, data, {
      token: getAccessToken()!,
    }),

  delete: (realm: string, depotId: string) =>
    http.delete<void>(`/api/realm/${realm}/depots/${depotId}`, { token: getAccessToken()! }),

  commit: (realm: string, depotId: string, root: string) =>
    http.post<FsMutationResponse>(
      `/api/realm/${realm}/depots/${depotId}/commit`,
      { root },
      { token: getAccessToken()! }
    ),
};
