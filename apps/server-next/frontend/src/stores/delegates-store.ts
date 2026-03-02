import { create } from "zustand";
import type { CreateDelegateResponse, DelegateListItem } from "../types/delegate";

type DelegatesStore = {
  delegates: DelegateListItem[];
  isLoading: boolean;
  error: string | null;
  includeRevoked: boolean;
  fetchDelegates: () => Promise<void>;
  setIncludeRevoked: (v: boolean) => void;
  createDelegate: (params: { name?: string; ttlSeconds?: number }) => Promise<CreateDelegateResponse>;
  revokeDelegate: (delegateId: string) => Promise<void>;
};

let mockId = 1;
const MOCK_LIST: DelegateListItem[] = [];

export const useDelegatesStore = create<DelegatesStore>((set, get) => ({
  delegates: [],
  isLoading: false,
  error: null,
  includeRevoked: false,

  fetchDelegates: async () => {
    set({ isLoading: true, error: null });
    try {
      const { includeRevoked } = get();
      const list = includeRevoked ? MOCK_LIST : MOCK_LIST.filter((d) => !d.isRevoked);
      set({ delegates: list });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch" });
    } finally {
      set({ isLoading: false });
    }
  },

  setIncludeRevoked: (v) => {
    set({ includeRevoked: v });
    get().fetchDelegates();
  },

  createDelegate: async (params) => {
    const delegateId = `mock-delegate-${mockId++}`;
    const now = Date.now();
    const ttl = params.ttlSeconds ?? 86400;
    const delegate: DelegateListItem = {
      delegateId,
      name: params.name?.trim() || undefined,
      createdAt: now,
      expiresAt: now + ttl * 1000,
      isRevoked: false,
      depth: 0,
    };
    MOCK_LIST.unshift(delegate);
    const response: CreateDelegateResponse = {
      delegate,
      accessToken: `mock-access-${delegateId}`,
      accessTokenExpiresAt: now + ttl * 1000,
    };
    return response;
  },

  revokeDelegate: async (delegateId: string) => {
    const d = MOCK_LIST.find((x) => x.delegateId === delegateId);
    if (d) d.isRevoked = true;
    await get().fetchDelegates();
  },
}));
