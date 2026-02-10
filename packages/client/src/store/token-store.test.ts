/**
 * Token store tests.
 */

import { describe, expect, it, mock } from "bun:test";
import type { TokenStorageProvider } from "../types/client.ts";
import type { StoredRootDelegate, StoredUserToken, TokenState } from "../types/tokens.ts";
import { emptyTokenState } from "../types/tokens.ts";
import { createTokenStore } from "./token-store.ts";

// ============================================================================
// Test Helpers
// ============================================================================

const createUserToken = (overrides: Partial<StoredUserToken> = {}): StoredUserToken => ({
  accessToken: "jwt-access-token",
  refreshToken: "jwt-refresh-token",
  userId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
  ...overrides,
});

const createRootDelegate = (overrides: Partial<StoredRootDelegate> = {}): StoredRootDelegate => ({
  delegateId: "dlg_root123",
  realm: "test-realm",
  refreshToken: "base64-refresh-token",
  accessToken: "base64-access-token",
  accessTokenExpiresAt: Date.now() + 3600_000,
  depth: 0,
  canUpload: true,
  canManageDepot: true,
  ...overrides,
});

const createMockStorage = (): TokenStorageProvider & {
  savedState: TokenState | null;
  loadResult: TokenState | null;
} => {
  const storage = {
    savedState: null as TokenState | null,
    loadResult: null as TokenState | null,
    load: mock(async () => storage.loadResult),
    save: mock(async (state: TokenState) => {
      storage.savedState = state;
    }),
    clear: mock(async () => {
      storage.savedState = null;
    }),
  };
  return storage;
};

// ============================================================================
// createTokenStore Tests
// ============================================================================

describe("createTokenStore", () => {
  describe("getState", () => {
    it("should return empty state initially", () => {
      const store = createTokenStore();
      const state = store.getState();

      expect(state.user).toBe(null);
      expect(state.rootDelegate).toBe(null);
    });

    it("should return a copy of state (immutable)", () => {
      const store = createTokenStore();
      const state1 = store.getState();
      const state2 = store.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("setUser", () => {
    it("should update user token", () => {
      const store = createTokenStore();
      const userToken = createUserToken();

      store.setUser(userToken);
      const state = store.getState();

      expect(state.user).toEqual(userToken);
    });

    it("should allow setting user to null", () => {
      const store = createTokenStore();
      store.setUser(createUserToken());
      store.setUser(null);

      expect(store.getState().user).toBe(null);
    });

    it("should trigger onTokenChange callback", () => {
      const onTokenChange = mock(() => {});
      const store = createTokenStore({ onTokenChange });
      const userToken = createUserToken();

      store.setUser(userToken);

      expect(onTokenChange).toHaveBeenCalledTimes(1);
      expect(onTokenChange).toHaveBeenCalledWith(expect.objectContaining({ user: userToken }));
    });

    it("should persist to storage", async () => {
      const storage = createMockStorage();
      const store = createTokenStore({ storage });
      const userToken = createUserToken();

      store.setUser(userToken);

      // Wait for async save
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(storage.save).toHaveBeenCalled();
      expect(storage.savedState?.user).toEqual(userToken);
    });
  });

  describe("setRootDelegate", () => {
    it("should update root delegate", () => {
      const store = createTokenStore();
      const rd = createRootDelegate();

      store.setRootDelegate(rd);
      const state = store.getState();

      expect(state.rootDelegate).toEqual(rd);
    });

    it("should not affect other tokens", () => {
      const store = createTokenStore();
      const userToken = createUserToken();
      const rd = createRootDelegate();

      store.setUser(userToken);
      store.setRootDelegate(rd);

      const state = store.getState();
      expect(state.user).toEqual(userToken);
      expect(state.rootDelegate).toEqual(rd);
    });

    it("should allow setting root delegate to null", () => {
      const store = createTokenStore();
      store.setRootDelegate(createRootDelegate());
      store.setRootDelegate(null);

      expect(store.getState().rootDelegate).toBe(null);
    });

    it("should trigger onTokenChange callback", () => {
      const onTokenChange = mock(() => {});
      const store = createTokenStore({ onTokenChange });
      const rd = createRootDelegate();

      store.setRootDelegate(rd);

      expect(onTokenChange).toHaveBeenCalledTimes(1);
      expect(onTokenChange).toHaveBeenCalledWith(expect.objectContaining({ rootDelegate: rd }));
    });

    it("should persist to storage", async () => {
      const storage = createMockStorage();
      const store = createTokenStore({ storage });
      const rd = createRootDelegate();

      store.setRootDelegate(rd);

      // Wait for async save
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(storage.save).toHaveBeenCalled();
      expect(storage.savedState?.rootDelegate).toEqual(rd);
    });
  });

  describe("clear", () => {
    it("should reset all tokens to null", () => {
      const store = createTokenStore();
      store.setUser(createUserToken());
      store.setRootDelegate(createRootDelegate());

      store.clear();
      const state = store.getState();

      expect(state.user).toBe(null);
      expect(state.rootDelegate).toBe(null);
    });

    it("should trigger onTokenChange callback", () => {
      const onTokenChange = mock(() => {});
      const store = createTokenStore({ onTokenChange });
      store.setUser(createUserToken());
      onTokenChange.mockClear();

      store.clear();

      expect(onTokenChange).toHaveBeenCalledTimes(1);
    });

    it("should clear storage", async () => {
      const storage = createMockStorage();
      const store = createTokenStore({ storage });
      store.setUser(createUserToken());

      store.clear();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(storage.clear).toHaveBeenCalled();
    });
  });

  describe("initialize", () => {
    it("should load state from storage", async () => {
      const storage = createMockStorage();
      const storedState: TokenState = {
        user: createUserToken(),
        rootDelegate: createRootDelegate(),
      };
      storage.loadResult = storedState;

      const store = createTokenStore({ storage });
      await store.initialize();

      const state = store.getState();
      expect(state.user).toEqual(storedState.user);
      expect(state.rootDelegate).toEqual(storedState.rootDelegate);
    });

    it("should do nothing when no storage provider", async () => {
      const store = createTokenStore();
      await store.initialize();

      expect(store.getState()).toEqual(emptyTokenState());
    });

    it("should handle null load result", async () => {
      const storage = createMockStorage();
      storage.loadResult = null;

      const store = createTokenStore({ storage });
      await store.initialize();

      expect(store.getState()).toEqual(emptyTokenState());
    });

    it("should handle storage load error gracefully", async () => {
      const storage = {
        load: mock(async () => {
          throw new Error("Storage error");
        }),
        save: mock(async () => {}),
        clear: mock(async () => {}),
      };

      const store = createTokenStore({ storage });

      // Should not throw
      await expect(store.initialize()).resolves.toBeUndefined();
      expect(store.getState()).toEqual(emptyTokenState());
    });

    it("should not trigger onTokenChange on initial load", async () => {
      const onTokenChange = mock(() => {});
      const storage = createMockStorage();
      storage.loadResult = {
        user: createUserToken(),
        rootDelegate: null,
      };

      const store = createTokenStore({ storage, onTokenChange });
      await store.initialize();

      expect(onTokenChange).not.toHaveBeenCalled();
    });
  });

  describe("state immutability", () => {
    it("should not allow external mutation of state", () => {
      const store = createTokenStore();
      const userToken = createUserToken();
      store.setUser(userToken);

      const state = store.getState();
      // Try to mutate the returned state
      (state as any).user = null;

      // Internal state should be unchanged
      expect(store.getState().user).toEqual(userToken);
    });
  });

  describe("storage error handling", () => {
    it("should handle save error gracefully", async () => {
      const storage = {
        load: mock(async () => null),
        save: mock(async () => {
          throw new Error("Save failed");
        }),
        clear: mock(async () => {}),
      };

      const store = createTokenStore({ storage });

      // Should not throw
      expect(() => store.setUser(createUserToken())).not.toThrow();
    });

    it("should handle clear error gracefully", async () => {
      const storage = {
        load: mock(async () => null),
        save: mock(async () => {}),
        clear: mock(async () => {
          throw new Error("Clear failed");
        }),
      };

      const store = createTokenStore({ storage });

      // Should not throw
      expect(() => store.clear()).not.toThrow();
    });
  });
});
