import { create } from "zustand";

export type AuthType = "mock" | "cognito" | null;

type AuthStore = {
  authType: AuthType;
  initialized: boolean;
  loading: boolean;
  initialize: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  authType: null,
  initialized: false,
  loading: true,

  initialize: async () => {
    if (get().initialized) return;
    set({ loading: true });

    try {
      const infoRes = await fetch("/api/info");
      if (!infoRes.ok) {
        set({ initialized: true, loading: false, authType: null });
        return;
      }
      const info = (await infoRes.json()) as { authType?: string };
      const authType =
        info.authType === "cognito" ? "cognito" : info.authType === "mock" ? "mock" : null;
      set({ authType, initialized: true, loading: false });
    } catch {
      set({ initialized: true, loading: false, authType: null });
    }
  },
}));
