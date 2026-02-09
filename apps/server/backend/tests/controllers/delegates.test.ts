/**
 * Unit tests for Delegates Controller
 *
 * Tests delegate CRUD operations with mocked dependencies:
 * - Create child delegate with permission validation
 * - List children
 * - Get delegate detail (ancestor check)
 * - Revoke delegate (cascading)
 * - Permission escalation rejection
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import {
  createDelegatesController,
  type DelegatesController,
  type DelegatesControllerDeps,
} from "../../src/controllers/delegates.ts";
import type { DelegatesDb } from "../../src/db/delegates.ts";
import type { TokenRecordsDb } from "../../src/db/token-records.ts";
import type { ScopeSetNodesDb } from "../../src/db/scope-set-nodes.ts";
import type { DepotsDb } from "../../src/db/depots.ts";
import type { AccessTokenAuthContext } from "../../src/types.ts";

// ============================================================================
// Constants
// ============================================================================

const TEST_REALM = "usr_testuser";
const ROOT_DELEGATE_ID = "root-dlg-001";
const CHILD_DELEGATE_ID = "child-dlg-001";

// ============================================================================
// Mock factories
// ============================================================================

function makeDelegate(overrides?: Partial<Delegate>): Delegate {
  return {
    delegateId: ROOT_DELEGATE_ID,
    realm: TEST_REALM,
    parentId: null,
    chain: [ROOT_DELEGATE_ID],
    depth: 0,
    canUpload: true,
    canManageDepot: true,
    isRevoked: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeChildDelegate(overrides?: Partial<Delegate>): Delegate {
  return makeDelegate({
    delegateId: CHILD_DELEGATE_ID,
    parentId: ROOT_DELEGATE_ID,
    chain: [ROOT_DELEGATE_ID, CHILD_DELEGATE_ID],
    depth: 1,
    canUpload: false,
    canManageDepot: false,
    ...overrides,
  });
}

function createMockAuth(overrides?: Partial<AccessTokenAuthContext>): AccessTokenAuthContext {
  return {
    type: "access",
    realm: TEST_REALM,
    tokenId: "tok-001",
    tokenBytes: new Uint8Array(128),
    tokenRecord: { delegateId: ROOT_DELEGATE_ID } as never,
    canUpload: true,
    canManageDepot: true,
    issuerChain: [ROOT_DELEGATE_ID],
    ...overrides,
  };
}

function createMockDelegatesDb(overrides?: Partial<DelegatesDb>): DelegatesDb {
  return {
    create: mock(async () => {}),
    get: mock(async (_realm: string, id: string) => {
      if (id === ROOT_DELEGATE_ID) return makeDelegate();
      if (id === CHILD_DELEGATE_ID) return makeChildDelegate();
      return null;
    }),
    revoke: mock(async () => true),
    listChildren: mock(async () => ({ delegates: [], nextCursor: undefined })),
    getOrCreateRoot: mock(async (realm: string, id: string) => makeDelegate({ delegateId: id, realm })),
    ...overrides,
  };
}

function createMockTokenRecordsDb(): TokenRecordsDb {
  return {
    create: mock(async () => {}),
    get: mock(async () => null),
    markUsed: mock(async () => true),
    invalidateFamily: mock(async () => 0),
    listByDelegate: mock(async () => ({ tokens: [], nextCursor: undefined })),
  };
}

function createMockScopeSetNodesDb(): ScopeSetNodesDb {
  return {
    getOrCreate: mock(async () => ({ setNodeId: "set-001", children: [], refCount: 1, createdAt: Date.now() })),
    createOrIncrement: mock(async () => {}),
    get: mock(async () => null),
  } as unknown as ScopeSetNodesDb;
}

function createMockDepotsDb(): DepotsDb {
  return {} as unknown as DepotsDb;
}

function createMockContext(options: {
  auth?: AccessTokenAuthContext;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const responseData: { body?: unknown; status?: number } = {};

  const context = {
    get: mock((key: string) => {
      if (key === "auth") return options.auth ?? createMockAuth();
      return undefined;
    }),
    set: mock(() => {}),
    req: {
      json: mock(async () => options.body ?? {}),
      param: mock((name: string) => (options.params ?? {})[name]),
      query: mock((name: string) => (options.query ?? {})[name]),
      header: mock(() => undefined),
    },
    json: mock((body: unknown, status?: number) => {
      responseData.body = body;
      responseData.status = status ?? 200;
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    }),
    responseData,
  };

  return context;
}

// ============================================================================
// Tests
// ============================================================================

describe("DelegatesController", () => {
  let controller: DelegatesController;
  let mockDelegatesDb: DelegatesDb;
  let mockTokenRecordsDb: TokenRecordsDb;

  beforeEach(() => {
    mockDelegatesDb = createMockDelegatesDb();
    mockTokenRecordsDb = createMockTokenRecordsDb();

    controller = createDelegatesController({
      delegatesDb: mockDelegatesDb,
      tokenRecordsDb: mockTokenRecordsDb,
      scopeSetNodesDb: createMockScopeSetNodesDb(),
      depotsDb: createMockDepotsDb(),
      getNode: mock(async () => null),
    });
  });

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------

  describe("create", () => {
    it("creates a child delegate and returns RT + AT", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        body: { name: "Agent-A", canUpload: false, canManageDepot: false },
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(201);
      const body = ctx.responseData.body as Record<string, unknown>;

      // Delegate info
      const delegate = body.delegate as Record<string, unknown>;
      expect(delegate.name).toBe("Agent-A");
      expect(delegate.realm).toBe(TEST_REALM);
      expect(delegate.parentId).toBe(ROOT_DELEGATE_ID);
      expect(delegate.depth).toBe(1);
      expect(delegate.canUpload).toBe(false);
      expect(delegate.canManageDepot).toBe(false);

      // Tokens
      expect(body.refreshToken).toBeDefined();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshTokenId).toBeDefined();
      expect(body.accessTokenId).toBeDefined();
      expect((body.refreshTokenId as string).startsWith("dlt1_")).toBe(true);
    });

    it("stores delegate in DB", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        body: { canUpload: false },
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(mockDelegatesDb.create).toHaveBeenCalledTimes(1);
      const createCall = (mockDelegatesDb.create as ReturnType<typeof mock>).mock.calls[0]!;
      const savedDelegate = createCall[0] as Delegate;
      expect(savedDelegate.realm).toBe(TEST_REALM);
      expect(savedDelegate.parentId).toBe(ROOT_DELEGATE_ID);
      expect(savedDelegate.depth).toBe(1);
    });

    it("stores 2 token records (RT + AT)", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        body: { canUpload: false },
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(mockTokenRecordsDb.create).toHaveBeenCalledTimes(2);
    });

    it("rejects realm mismatch (403)", async () => {
      const ctx = createMockContext({
        auth: createMockAuth({ realm: "usr_alice" }),
        body: {},
        params: { realmId: "usr_bob" }, // Different realm
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(403);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("REALM_MISMATCH");
    });

    it("rejects permission escalation — canUpload", async () => {
      const parentDelegate = makeDelegate({
        canUpload: false,
        canManageDepot: false,
      });
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => parentDelegate),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        body: { canUpload: true }, // Parent doesn't have upload → escalation
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(400);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("PERMISSION_ESCALATION");
    });

    it("rejects permission escalation — canManageDepot", async () => {
      const parentDelegate = makeDelegate({
        canUpload: true,
        canManageDepot: false,
      });
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => parentDelegate),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        body: { canManageDepot: true }, // Parent doesn't have → escalation
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(400);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("PERMISSION_ESCALATION");
    });

    it("rejects revoked parent delegate (403)", async () => {
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => makeDelegate({ isRevoked: true })),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        body: {},
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(403);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_REVOKED");
    });

    it("rejects when parent delegate not found (404)", async () => {
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async () => null),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        body: {},
        params: { realmId: TEST_REALM },
      });

      await controller.create(ctx as never);

      expect(ctx.responseData.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------

  describe("list", () => {
    it("lists children of the caller's delegate", async () => {
      const children = [
        makeChildDelegate({ delegateId: "c1", name: "Agent-1" }),
        makeChildDelegate({ delegateId: "c2", name: "Agent-2" }),
      ];
      mockDelegatesDb = createMockDelegatesDb({
        listChildren: mock(async () => ({ delegates: children, nextCursor: undefined })),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM },
      });

      await controller.list(ctx as never);

      expect(ctx.responseData.status).toBe(200);
      const body = ctx.responseData.body as Record<string, unknown>;
      const delegates = body.delegates as Array<Record<string, unknown>>;
      expect(delegates.length).toBe(2);
    });

    it("filters out revoked delegates by default", async () => {
      const children = [
        makeChildDelegate({ delegateId: "c1", isRevoked: false }),
        makeChildDelegate({ delegateId: "c2", isRevoked: true }),
      ];
      mockDelegatesDb = createMockDelegatesDb({
        listChildren: mock(async () => ({ delegates: children, nextCursor: undefined })),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM },
      });

      await controller.list(ctx as never);

      const body = ctx.responseData.body as Record<string, unknown>;
      const delegates = body.delegates as Array<Record<string, unknown>>;
      expect(delegates.length).toBe(1);
      expect(delegates[0]?.delegateId).toBe("c1");
    });

    it("includes revoked when includeRevoked=true", async () => {
      const children = [
        makeChildDelegate({ delegateId: "c1", isRevoked: false }),
        makeChildDelegate({ delegateId: "c2", isRevoked: true }),
      ];
      mockDelegatesDb = createMockDelegatesDb({
        listChildren: mock(async () => ({ delegates: children, nextCursor: undefined })),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM },
        query: { includeRevoked: "true" },
      });

      await controller.list(ctx as never);

      const body = ctx.responseData.body as Record<string, unknown>;
      const delegates = body.delegates as Array<Record<string, unknown>>;
      expect(delegates.length).toBe(2);
    });

    it("rejects realm mismatch", async () => {
      const ctx = createMockContext({
        auth: createMockAuth({ realm: "usr_alice" }),
        params: { realmId: "usr_bob" },
      });

      await controller.list(ctx as never);

      expect(ctx.responseData.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // get
  // --------------------------------------------------------------------------

  describe("get", () => {
    it("returns delegate detail for ancestor caller", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: CHILD_DELEGATE_ID },
      });

      await controller.get(ctx as never);

      expect(ctx.responseData.status).toBe(200);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.delegateId).toBe(CHILD_DELEGATE_ID);
      expect(body.parentId).toBe(ROOT_DELEGATE_ID);
    });

    it("returns 404 for non-existent delegate", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: "nonexistent" },
      });

      await controller.get(ctx as never);

      expect(ctx.responseData.status).toBe(404);
    });

    it("returns 404 when caller is not ancestor of target", async () => {
      // Caller is a sibling (not in target's chain)
      const targetDelegate = makeChildDelegate({
        delegateId: "target-dlg",
        parentId: "other-parent",
        chain: ["other-parent", "target-dlg"],
      });
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async (_r: string, id: string) =>
          id === "target-dlg" ? targetDelegate : makeDelegate(),
        ),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(), // ROOT_DELEGATE_ID is not in target's chain
        params: { realmId: TEST_REALM, delegateId: "target-dlg" },
      });

      await controller.get(ctx as never);

      expect(ctx.responseData.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // revoke
  // --------------------------------------------------------------------------

  describe("revoke", () => {
    it("revokes a delegate and returns revokedAt", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: CHILD_DELEGATE_ID },
      });

      await controller.revoke(ctx as never);

      expect(ctx.responseData.status).toBe(200);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.delegateId).toBe(CHILD_DELEGATE_ID);
      expect(body.revokedAt).toBeGreaterThan(0);
    });

    it("calls delegatesDb.revoke", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: CHILD_DELEGATE_ID },
      });

      await controller.revoke(ctx as never);

      expect(mockDelegatesDb.revoke).toHaveBeenCalledTimes(1);
    });

    it("returns 409 for already-revoked delegate", async () => {
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async (_r: string, id: string) => {
          if (id === CHILD_DELEGATE_ID) {
            return makeChildDelegate({ isRevoked: true });
          }
          return makeDelegate();
        }),
      });
      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: CHILD_DELEGATE_ID },
      });

      await controller.revoke(ctx as never);

      expect(ctx.responseData.status).toBe(409);
      const body = ctx.responseData.body as Record<string, unknown>;
      expect(body.error).toBe("DELEGATE_ALREADY_REVOKED");
    });

    it("returns 404 for non-existent delegate", async () => {
      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: "nonexistent" },
      });

      await controller.revoke(ctx as never);

      expect(ctx.responseData.status).toBe(404);
    });

    it("cascading revoke calls listChildren + revoke for descendants", async () => {
      const grandchild = makeDelegate({
        delegateId: "grandchild-1",
        parentId: CHILD_DELEGATE_ID,
        chain: [ROOT_DELEGATE_ID, CHILD_DELEGATE_ID, "grandchild-1"],
        depth: 2,
      });

      let listCallCount = 0;
      mockDelegatesDb = createMockDelegatesDb({
        get: mock(async (_r: string, id: string) => {
          if (id === CHILD_DELEGATE_ID) return makeChildDelegate();
          if (id === ROOT_DELEGATE_ID) return makeDelegate();
          return null;
        }),
        listChildren: mock(async (parentId: string) => {
          listCallCount++;
          if (parentId === CHILD_DELEGATE_ID) {
            return { delegates: [grandchild], nextCursor: undefined };
          }
          return { delegates: [], nextCursor: undefined };
        }),
        revoke: mock(async () => true),
      });

      controller = createDelegatesController({
        delegatesDb: mockDelegatesDb,
        tokenRecordsDb: mockTokenRecordsDb,
        scopeSetNodesDb: createMockScopeSetNodesDb(),
        depotsDb: createMockDepotsDb(),
        getNode: mock(async () => null),
      });

      const ctx = createMockContext({
        auth: createMockAuth(),
        params: { realmId: TEST_REALM, delegateId: CHILD_DELEGATE_ID },
      });

      await controller.revoke(ctx as never);

      // Should have revoked CHILD + grandchild = 2 revoke calls
      expect(mockDelegatesDb.revoke).toHaveBeenCalledTimes(2);
    });
  });
});
