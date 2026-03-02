import { create } from "zustand";
import type { CreateDelegateResponse, DelegateListItem } from "../types/delegate";
import { useAuthStore } from "./auth-store";
import { apiFetch } from "../lib/auth";

type DelegatesStore = {
  delegates: DelegateListItem[];
  isLoading: boolean;
  error: string | null;
  fetchDelegates: () => Promise<void>;
  createDelegate: (params: { name?: string; ttlSeconds?: number }) => Promise<CreateDelegateResponse>;
  revokeDelegate: (delegateId: string) => Promise<void>;
};

function getRealmId(): string {
  const realmId = useAuthStore.getState().user?.userId;
  if (!realmId) throw new Error("Not authenticated: realmId (user) not loaded");
  return realmId;
}

/** Map backend list item to DelegateListItem. Backend has no name (use clientId) and no isRevoked (revoked are omitted). */
function mapDelegateItem(d: {
  delegateId: string;
  clientId?: string;
  permissions?: string[];
  createdAt: number;
  expiresAt?: number | null;
  refreshable?: boolean;
}): DelegateListItem {
  return {
    delegateId: d.delegateId,
    name: typeof d.clientId === "string" && d.clientId.trim() ? d.clientId.trim() : undefined,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt ?? undefined,
    isRevoked: false,
    refreshable: d.refreshable ?? false,
  };
}

export const useDelegatesStore = create<DelegatesStore>((set, get) => ({
  delegates: [],
  isLoading: false,
  error: null,

  fetchDelegates: async () => {
    set({ isLoading: true, error: null });
    try {
      const realmId = getRealmId();
      const res = await apiFetch(`/api/realm/${realmId}/delegates`);
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? "Failed to fetch delegates");
      }
      const data = (await res.json()) as {
        delegates?: Array<{
          delegateId: string;
          clientId?: string;
          permissions?: string[];
          createdAt: number;
          expiresAt?: number | null;
          refreshable?: boolean;
        }>;
      };
      const list = (data.delegates ?? []).map(mapDelegateItem);
      set({ delegates: list });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch delegates" });
    } finally {
      set({ isLoading: false });
    }
  },

  createDelegate: async (params) => {
    const realmId = getRealmId();
    const ttlMs = typeof params.ttlSeconds === "number" && params.ttlSeconds > 0
      ? params.ttlSeconds * 1000
      : 86400 * 1000;
    const body: { ttl: number; client_id?: string } = { ttl: ttlMs };
    if (params.name?.trim()) body.client_id = params.name.trim();

    const res = await apiFetch(`/api/realm/${realmId}/delegates/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      throw new Error(data.message ?? data.error ?? "Failed to create delegate");
    }
    const raw = (await res.json()) as {
      delegateId: string;
      accessToken: string;
      clientId: string;
      expiresAt?: number | null;
    };
    const now = Date.now();
    const delegate: DelegateListItem = {
      delegateId: raw.delegateId,
      name: raw.clientId?.trim() || undefined,
      createdAt: now,
      expiresAt: raw.expiresAt ?? undefined,
      isRevoked: false,
    };
    const response: CreateDelegateResponse = {
      delegate,
      accessToken: raw.accessToken,
      accessTokenExpiresAt: raw.expiresAt ?? now + ttlMs,
    };
    return response;
  },

  revokeDelegate: async (delegateId: string) => {
    const realmId = getRealmId();
    const res = await apiFetch(`/api/realm/${realmId}/delegates/${encodeURIComponent(delegateId)}/revoke`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      throw new Error(data.message ?? data.error ?? "Failed to revoke delegate");
    }
    await get().fetchDelegates();
  },
}));
