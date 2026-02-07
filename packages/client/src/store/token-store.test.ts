/**
 * Token store tests.
 */

import { describe, expect, it, mock } from "bun:test";
import type { TokenStorageProvider } from "../types/client.ts";
import type {
  StoredAccessToken,
  StoredDelegateToken,
  StoredUserToken,
  TokenState,
} from "../types/tokens.ts";
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

const createDelegateToken = (
  overrides: Partial<StoredDelegateToken> = {}
): StoredDelegateToken => ({
  tokenId: "dlt1_delegate123",
  tokenBase64: "base64-delegate-token",
  type: "delegate",
  issuerId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
  canUpload: true,
  canManageDepot: true,
  ...overrides,
});

const createAccessToken = (overrides: Partial<StoredAccessToken> = {}): StoredAccessToken => ({
  tokenId: "dlt1_access123",
  tokenBase64: "base64-access-token",
  type: "access",
  issuerId: "usr_test123",
  expiresAt: Date.now() + 3600_000,
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
      expect(state.delegate).toBe(null);
      expect(state.access).toBe(null);
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

  describe("setDelegate", () => {
    it("should update delegate token", () => {
      const store = createTokenStore();
      const delegateToken = createDelegateToken();

      store.setDelegate(delegateToken);
      const state = store.getState();

      expect(state.delegate).toEqual(delegateToken);
    });

    it("should not affect other tokens", () => {
      const store = createTokenStore();
      const userToken = createUserToken();
      const delegateToken = createDelegateToken();

      store.setUser(userToken);
      store.setDelegate(delegateToken);

      const state = store.getState();
      expect(state.user).toEqual(userToken);
      expect(state.delegate).toEqual(delegateToken);
    });
  });

  describe("setAccess", () => {
    it("should update access token", () => {
      const store = createTokenStore();
      const accessToken = createAccessToken();

      store.setAccess(accessToken);
      const state = store.getState();

      expect(state.access).toEqual(accessToken);
    });
  });

  describe("clear", () => {
    it("should reset all tokens to null", () => {
      const store = createTokenStore();
      store.setUser(createUserToken());
      store.setDelegate(createDelegateToken());
      store.setAccess(createAccessToken());

      store.clear();
      const state = store.getState();

      expect(state.user).toBe(null);
      expect(state.delegate).toBe(null);
      expect(state.access).toBe(null);
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
        delegate: createDelegateToken(),
        access: createAccessToken(),
      };
      storage.loadResult = storedState;

      const store = createTokenStore({ storage });
      await store.initialize();

      const state = store.getState();
      expect(state.user).toEqual(storedState.user);
      expect(state.delegate).toEqual(storedState.delegate);
      expect(state.access).toEqual(storedState.access);
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
        delegate: null,
        access: null,
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
