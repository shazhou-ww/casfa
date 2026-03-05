import { create } from "zustand";
import type { CreateDelegateResponse, DelegateListItem } from "../types/delegate";
import { authClient, apiFetch } from "../lib/auth";

type DelegatesStore = {
  delegates: DelegateListItem[];
  isLoading: boolean;
  error: string | null;
  fetchDelegates: () => Promise<void>;
  createDelegate: (params: { name?: string; ttlSeconds?: number }) => Promise<CreateDelegateResponse>;
  revokeDelegate: (delegateId: string) => Promise<void>;
};

function requireAuth(): void {
  const userId = authClient.getAuth()?.userId;
  if (!userId) throw new Error("Not authenticated: user not loaded");
}

/** Map backend list item to DelegateListItem. Backend returns clientName; revoked are omitted. */
function mapDelegateItem(d: {
  delegateId: string;
  clientName?: string;
  permissions?: string[];
  createdAt: number;
  expiresAt?: number | null;
}): DelegateListItem {
  return {
    delegateId: d.delegateId,
    name: typeof d.clientName === "string" && d.clientName.trim() ? d.clientName.trim() : undefined,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt ?? undefined,
    isRevoked: false,
  };
}

export const useDelegatesStore = create<DelegatesStore>((set, get) => ({
  delegates: [],
  isLoading: false,
  error: null,

  fetchDelegates: async () => {
    set({ isLoading: true, error: null });
    try {
      requireAuth();
      const res = await apiFetch("/api/delegates");
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? "Failed to fetch delegates");
      }
      const data = (await res.json()) as Array<{
        delegateId: string;
        clientName?: string;
        permissions?: string[];
        createdAt: number;
        expiresAt?: number | null;
      }>;
      const list = (Array.isArray(data) ? data : []).map(mapDelegateItem);
      set({ delegates: list });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch delegates" });
    } finally {
      set({ isLoading: false });
    }
  },

  createDelegate: async (params) => {
    requireAuth();
    const body: { clientName: string; permissions?: string[] } = {
      clientName: params.name?.trim() || "Delegate",
    };
    const res = await apiFetch("/api/delegates", {
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
      clientName: string;
      accessToken: string;
      refreshToken?: string;
      permissions?: string[];
      expiresAt?: number | null;
    };
    const now = Date.now();
    const delegate: DelegateListItem = {
      delegateId: raw.delegateId,
      name: raw.clientName?.trim() || undefined,
      createdAt: now,
      expiresAt: raw.expiresAt ?? undefined,
      isRevoked: false,
    };
    const response: CreateDelegateResponse = {
      delegate,
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      accessTokenExpiresAt: raw.expiresAt ?? now + 86400 * 1000,
    };
    return response;
  },

  revokeDelegate: async (delegateId: string) => {
    requireAuth();
    const res = await apiFetch(`/api/delegates/${encodeURIComponent(delegateId)}/revoke`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      throw new Error(data.message ?? data.error ?? "Failed to revoke delegate");
    }
    await get().fetchDelegates();
  },
}));
