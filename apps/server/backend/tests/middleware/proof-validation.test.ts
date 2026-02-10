/**
 * Proof Validation Middleware — unit tests
 *
 * Tests the Hono middleware using `app.request()` (Hono test client).
 * All I/O is mocked — no real DynamoDB or CAS storage.
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  createMultiNodeProofMiddleware,
  createProofValidationMiddleware,
  type ProofValidationMiddlewareDeps,
} from "../../src/middleware/proof-validation.ts";
import type { AccessTokenAuthContext, Env } from "../../src/types.ts";

// ============================================================================
// Mock DAG (same as @casfa/proof tests)
// ============================================================================

/**
 * ```
 * root_aaa
 *   ├── [0] bbb
 *   │     ├── [0] ddd
 *   │     └── [1] eee
 *   └── [1] ccc
 *         └── [0] fff
 * ```
 */
const dagNodes: Record<string, { children: string[] }> = {
  root_aaa: { children: ["bbb", "ccc"] },
  bbb: { children: ["ddd", "eee"] },
  ccc: { children: ["fff"] },
  ddd: { children: [] },
  eee: { children: [] },
  fff: { children: [] },
};

// ============================================================================
// Mutable state for tests
// ============================================================================

const ownershipSet = new Set<string>();
const rootDelegateSet = new Set<string>();
const scopeRoots: Record<string, string[]> = {};
const depotAccessSet = new Set<string>();
const depotVersions: Record<string, Record<string, string>> = {
  depot_1: { v1: "root_aaa" },
};

function resetState() {
  ownershipSet.clear();
  rootDelegateSet.clear();
  for (const k of Object.keys(scopeRoots)) delete scopeRoots[k];
  depotAccessSet.clear();
}

// ============================================================================
// Mock deps
// ============================================================================

const mockDeps: ProofValidationMiddlewareDeps = {
  hasOwnership: async (nodeHash, delegateId) => ownershipSet.has(`${nodeHash}:${delegateId}`),
  isRootDelegate: async (id) => rootDelegateSet.has(id),
  getScopeRoots: async (id) => scopeRoots[id] ?? [],
  resolveNode: async (_realm, hash) => dagNodes[hash] ?? null,
  resolveDepotVersion: async (_realm, depotId, version) =>
    depotVersions[depotId]?.[version] ?? null,
  hasDepotAccess: async (delegateId, depotId) => depotAccessSet.has(`${delegateId}:${depotId}`),
};

// ============================================================================
// Mock auth context
// ============================================================================

function mockAuth(overrides?: Partial<AccessTokenAuthContext>): AccessTokenAuthContext {
  return {
    type: "access",
    realm: "test-realm",
    tokenBytes: new Uint8Array(32),
    delegate: {
      delegateId: "dlg_child",
      realm: "test-realm",
      parentId: "dlg_root",
      chain: ["dlg_root", "dlg_child"],
      depth: 1,
      canUpload: true,
      canManageDepot: false,
      isRevoked: false,
      createdAt: Date.now(),
    } as never,
    delegateId: "dlg_child",
    canUpload: true,
    canManageDepot: false,
    issuerChain: ["dlg_root", "dlg_child"],
    ...overrides,
  };
}

// ============================================================================
// Helpers — build Hono apps for testing
// ============================================================================

function singleNodeApp() {
  const app = new Hono<Env>();
  app.use("/api/realm/:realmId/nodes/:key", (c, next) => {
    c.set("auth", mockAuth());
    return next();
  });
  app.use("/api/realm/:realmId/nodes/:key", createProofValidationMiddleware(mockDeps));
  app.get("/api/realm/:realmId/nodes/:key", (c) => {
    return c.json({ ok: true });
  });
  return app;
}

function multiNodeApp() {
  const app = new Hono<Env>();
  app.use("/api/realm/:realmId/nodes/:key", (c, next) => {
    c.set("auth", mockAuth());
    return next();
  });
  app.use(
    "/api/realm/:realmId/nodes/:key",
    createMultiNodeProofMiddleware(mockDeps, () => ["bbb", "ccc"])
  );
  app.put("/api/realm/:realmId/nodes/:key", (c) => {
    return c.json({ ok: true });
  });
  return app;
}

// ============================================================================
// Single-node middleware
// ============================================================================

describe("proof middleware — single node", () => {
  it("passes with ownership (no proof needed)", async () => {
    resetState();
    ownershipSet.add("eee:dlg_child");
    scopeRoots.dlg_child = ["root_aaa"];

    const app = singleNodeApp();
    const res = await app.request("/api/realm/test-realm/nodes/eee");
    expect(res.status).toBe(200);
  });

  it("passes with root delegate (no proof needed)", async () => {
    resetState();
    // Root delegate has depth=0, no parentId
    const app = new Hono<Env>();
    app.use("/api/realm/:realmId/nodes/:key", (c, next) => {
      c.set(
        "auth",
        mockAuth({
          delegate: {
            delegateId: "dlg_root",
            realm: "test-realm",
            parentId: null,
            chain: ["dlg_root"],
            depth: 0,
            canUpload: true,
            canManageDepot: true,
            isRevoked: false,
            createdAt: Date.now(),
          } as never,
          delegateId: "dlg_root",
          issuerChain: ["dlg_root"],
        })
      );
      return next();
    });
    app.use("/api/realm/:realmId/nodes/:key", createProofValidationMiddleware(mockDeps));
    app.get("/api/realm/:realmId/nodes/:key", (c) => {
      return c.json({ ok: true });
    });
    const res = await app.request("/api/realm/test-realm/nodes/eee");
    expect(res.status).toBe(200);
  });

  it("passes with valid ipath proof", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];

    const app = singleNodeApp();
    const proof = JSON.stringify({ eee: "ipath#0:0:1" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when no proof and no ownership", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];

    const app = singleNodeApp();
    const res = await app.request("/api/realm/test-realm/nodes/eee");
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("PROOF_REQUIRED");
  });

  it("returns 403 when proof path leads to wrong node", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];

    const app = singleNodeApp();
    // Path 0:0:0 → ddd, but we're requesting eee
    const proof = JSON.stringify({ eee: "ipath#0:0:0" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("NODE_NOT_IN_SCOPE");
  });

  it("returns 400 for malformed proof header", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];

    const app = singleNodeApp();
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": "not-json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("INVALID_PROOF_FORMAT");
  });

  it("returns 403 for scope root out of bounds", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"]; // only 1 root

    const app = singleNodeApp();
    const proof = JSON.stringify({ eee: "ipath#5:0:1" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("NODE_NOT_IN_SCOPE");
  });

  it("returns 404 for node not found during proof walk", async () => {
    resetState();
    scopeRoots.dlg_child = ["ghost_node"]; // doesn't exist in DAG

    const app = singleNodeApp();
    const proof = JSON.stringify({ eee: "ipath#0:0" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("NODE_NOT_FOUND");
  });

  it("passes with depot-version proof", async () => {
    resetState();
    depotAccessSet.add("dlg_child:depot_1");

    const app = singleNodeApp();
    const proof = JSON.stringify({ eee: "depot:depot_1@v1#0:1" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 for depot access denied", async () => {
    resetState();
    // no depot access

    const app = singleNodeApp();
    const proof = JSON.stringify({ eee: "depot:depot_1@v1#0:1" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("DEPOT_ACCESS_DENIED");
  });
});

// ============================================================================
// Multi-node middleware
// ============================================================================

describe("proof middleware — multi node", () => {
  it("passes when all children have valid proofs", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];

    const app = multiNodeApp();
    const proof = JSON.stringify({
      bbb: "ipath#0:0",
      ccc: "ipath#0:1",
    });
    const res = await app.request("/api/realm/test-realm/nodes/parent_node", {
      method: "PUT",
      headers: { "X-CAS-Proof": proof },
    });
    expect(res.status).toBe(200);
  });

  it("passes when children have ownership", async () => {
    resetState();
    ownershipSet.add("bbb:dlg_child");
    ownershipSet.add("ccc:dlg_child");

    const app = multiNodeApp();
    const res = await app.request("/api/realm/test-realm/nodes/parent_node", {
      method: "PUT",
    });
    expect(res.status).toBe(200);
  });

  it("fails when one child has no proof or ownership", async () => {
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];
    ownershipSet.add("bbb:dlg_child");
    // ccc has no ownership and no proof

    const app = multiNodeApp();
    const res = await app.request("/api/realm/test-realm/nodes/parent_node", {
      method: "PUT",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("PROOF_REQUIRED");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("proof middleware — edge cases", () => {
  it("derives delegateId from last element of issuerChain", async () => {
    resetState();
    // The mock auth has issuerChain ["dlg_root", "dlg_child"]
    // So delegateId should be "dlg_child"
    ownershipSet.add("eee:dlg_child"); // ownership for dlg_child

    const app = singleNodeApp();
    const res = await app.request("/api/realm/test-realm/nodes/eee");
    expect(res.status).toBe(200);
  });

  it("passes with empty proof header when ownership exists", async () => {
    resetState();
    ownershipSet.add("eee:dlg_child");

    const app = singleNodeApp();
    // No X-CAS-Proof header at all
    const res = await app.request("/api/realm/test-realm/nodes/eee");
    expect(res.status).toBe(200);
  });

  it("passes with new and old headers — transition period", async () => {
    // During transition, both X-CAS-Index-Path and X-CAS-Proof may coexist
    // The new middleware only reads X-CAS-Proof
    resetState();
    scopeRoots.dlg_child = ["root_aaa"];

    const app = singleNodeApp();
    const proof = JSON.stringify({ eee: "ipath#0:0:1" });
    const res = await app.request("/api/realm/test-realm/nodes/eee", {
      headers: {
        "X-CAS-Proof": proof,
        "X-CAS-Index-Path": "0:0:1",
      },
    });
    expect(res.status).toBe(200);
  });
});
