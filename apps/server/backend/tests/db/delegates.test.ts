/**
 * Unit tests for Delegates DB module
 *
 * Tests the delegates database layer using mocked DynamoDB client.
 * Tests cover: create, get, revoke, listChildren, getOrCreateRoot.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Delegate } from "@casfa/delegate";
import { createDelegatesDb, type DelegatesDb } from "../../src/db/delegates.ts";

// ============================================================================
// In-memory DynamoDB mock
// ============================================================================

type Item = Record<string, unknown>;

/**
 * Simple in-memory DynamoDB mock that supports:
 * - PutCommand (with ConditionExpression for conditional puts)
 * - GetCommand
 * - UpdateCommand (with ConditionExpression)
 * - QueryCommand (with KeyConditionExpression on gsi1pk, FilterExpression)
 */
function createMockDynamoClient() {
  const items: Map<string, Item> = new Map();

  /** Build a composite key from pk + sk */
  const compositeKey = (pk: string, sk: string) => `${pk}||${sk}`;

  const send = mock(async (command: unknown) => {
    const cmd = command as {
      input: Record<string, unknown>;
      constructor: { name: string };
    };
    const cmdName = cmd.constructor.name;

    if (cmdName === "PutCommand") {
      const input = cmd.input as {
        Item: Item;
        ConditionExpression?: string;
      };
      const item = input.Item;
      const pk = item.pk as string;
      const sk = item.sk as string;
      const cKey = compositeKey(pk, sk);

      // Check condition expression (attribute_not_exists)
      if (input.ConditionExpression?.includes("attribute_not_exists")) {
        if (items.has(cKey)) {
          const error = new Error("Condition not met");
          (error as unknown as { name: string }).name = "ConditionalCheckFailedException";
          throw error;
        }
      }

      items.set(cKey, { ...item });
      return {};
    }

    if (cmdName === "GetCommand") {
      const input = cmd.input as { Key: { pk: string; sk: string } };
      const cKey = compositeKey(input.Key.pk, input.Key.sk);
      const item = items.get(cKey);
      return { Item: item ?? undefined };
    }

    if (cmdName === "UpdateCommand") {
      const input = cmd.input as {
        Key: { pk: string; sk: string };
        UpdateExpression: string;
        ConditionExpression?: string;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
      const cKey = compositeKey(input.Key.pk, input.Key.sk);
      const item = items.get(cKey);

      // Check condition
      if (input.ConditionExpression) {
        if (!item) {
          const error = new Error("Condition not met");
          (error as unknown as { name: string }).name = "ConditionalCheckFailedException";
          throw error;
        }
        // Check isRevoked = :false condition
        if (input.ConditionExpression.includes("isRevoked = :false") && item.isRevoked === true) {
          const error = new Error("Condition not met");
          (error as unknown as { name: string }).name = "ConditionalCheckFailedException";
          throw error;
        }
        // Check currentRtHash = :expectedRt condition (for rotateTokens)
        if (input.ConditionExpression.includes("currentRtHash = :expectedRt")) {
          const vals = input.ExpressionAttributeValues ?? {};
          if (item.currentRtHash !== vals[":expectedRt"]) {
            const error = new Error("Condition not met");
            (error as unknown as { name: string }).name = "ConditionalCheckFailedException";
            throw error;
          }
        }
      }

      if (item && input.ExpressionAttributeValues) {
        // Simple SET parser
        const vals = input.ExpressionAttributeValues;
        if (input.UpdateExpression.includes("isRevoked = :true")) {
          item.isRevoked = vals[":true"];
        }
        if (input.UpdateExpression.includes("revokedAt = :now")) {
          item.revokedAt = vals[":now"];
        }
        if (input.UpdateExpression.includes("revokedBy = :by")) {
          item.revokedBy = vals[":by"];
        }
        // Handle rotateTokens update
        if (input.UpdateExpression.includes("currentRtHash = :newRt")) {
          item.currentRtHash = vals[":newRt"];
        }
        if (input.UpdateExpression.includes("currentAtHash = :newAt")) {
          item.currentAtHash = vals[":newAt"];
        }
        if (input.UpdateExpression.includes("atExpiresAt = :newExp")) {
          item.atExpiresAt = vals[":newExp"];
        }
        items.set(cKey, item);
      }
      return {};
    }

    if (cmdName === "QueryCommand") {
      const input = cmd.input as {
        IndexName?: string;
        ExpressionAttributeValues?: Record<string, unknown>;
        FilterExpression?: string;
        ExpressionAttributeNames?: Record<string, string>;
        Limit?: number;
      };

      const vals = input.ExpressionAttributeValues ?? {};
      const pkValue = vals[":pk"] as string | undefined;

      const matching: Item[] = [];
      for (const item of items.values()) {
        if (input.IndexName === "gsi1") {
          // GSI1: realm-index — match on gsi1pk
          if (pkValue && item.gsi1pk !== pkValue) continue;
        } else if (input.IndexName === "gsi2") {
          // GSI2: parent-index — match on gsi2pk
          if (pkValue && item.gsi2pk !== pkValue) continue;
        }

        // Apply FilterExpression for realm filter
        if (input.FilterExpression?.includes("realm = :realm")) {
          const filterRealm = vals[":realm"] as string;
          if (item.realm !== filterRealm) continue;
        }

        matching.push(item);
      }

      const limit = input.Limit ?? matching.length;
      const sliced = matching.slice(0, limit);

      return { Items: sliced, Count: sliced.length };
    }

    throw new Error(`Unsupported command: ${cmdName}`);
  });

  return { send, items };
}

// ============================================================================
// Helpers
// ============================================================================

function makeRootDelegate(
  realm: string,
  delegateId: string,
  overrides?: Partial<Delegate>
): Delegate {
  return {
    delegateId,
    realm,
    parentId: null,
    chain: [delegateId],
    depth: 0,
    canUpload: true,
    canManageDepot: true,
    isRevoked: false,
    createdAt: Date.now(),
    currentRtHash: "a".repeat(32),
    currentAtHash: "b".repeat(32),
    atExpiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

function makeChildDelegate(
  realm: string,
  delegateId: string,
  parentId: string,
  parentChain: string[],
  overrides?: Partial<Delegate>
): Delegate {
  return {
    delegateId,
    realm,
    parentId,
    chain: [...parentChain, delegateId],
    depth: parentChain.length,
    canUpload: true,
    canManageDepot: false,
    isRevoked: false,
    createdAt: Date.now(),
    currentRtHash: "a".repeat(32),
    currentAtHash: "b".repeat(32),
    atExpiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("DelegatesDb", () => {
  let db: DelegatesDb;
  let mockClient: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    mockClient = createMockDynamoClient();
    db = createDelegatesDb({
      tableName: "test-realm-table",
      client: mockClient as never,
    });
  });

  // --------------------------------------------------------------------------
  // create + get
  // --------------------------------------------------------------------------

  describe("create + get", () => {
    it("creates and retrieves a root delegate", async () => {
      const root = makeRootDelegate("realm-1", "dlg-root");
      await db.create(root);

      const retrieved = await db.get("dlg-root");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.delegateId).toBe("dlg-root");
      expect(retrieved!.parentId).toBeNull();
      expect(retrieved!.depth).toBe(0);
      expect(retrieved!.chain).toEqual(["dlg-root"]);
      expect(retrieved!.canUpload).toBe(true);
      expect(retrieved!.canManageDepot).toBe(true);
      expect(retrieved!.isRevoked).toBe(false);
    });

    it("creates a child delegate with all fields", async () => {
      const child = makeChildDelegate("realm-1", "dlg-child", "dlg-root", ["dlg-root"], {
        name: "Agent-A",
        canManageDepot: true,
        delegatedDepots: ["depot-1", "depot-2"],
        scopeNodeHash: "abc123",
        expiresAt: Date.now() + 3600_000,
      });

      await db.create(child);
      const retrieved = await db.get("dlg-child");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("Agent-A");
      expect(retrieved!.parentId).toBe("dlg-root");
      expect(retrieved!.depth).toBe(1);
      expect(retrieved!.chain).toEqual(["dlg-root", "dlg-child"]);
      expect(retrieved!.delegatedDepots).toEqual(["depot-1", "depot-2"]);
      expect(retrieved!.scopeNodeHash).toBe("abc123");
      expect(retrieved!.expiresAt).toBeGreaterThan(0);
    });

    it("returns null for non-existent delegate", async () => {
      const result = await db.get("non-existent");
      expect(result).toBeNull();
    });

    it("rejects duplicate create (conditional put)", async () => {
      const root = makeRootDelegate("realm-1", "dlg-root");
      await db.create(root);

      await expect(db.create(root)).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // revoke
  // --------------------------------------------------------------------------

  describe("revoke", () => {
    it("revokes an active delegate", async () => {
      const root = makeRootDelegate("realm-1", "dlg-root");
      await db.create(root);

      const result = await db.revoke("dlg-root", "admin");
      expect(result).toBe(true);

      const retrieved = await db.get("dlg-root");
      expect(retrieved!.isRevoked).toBe(true);
      expect(retrieved!.revokedBy).toBe("admin");
      expect(retrieved!.revokedAt).toBeGreaterThan(0);
    });

    it("returns false for already-revoked delegate", async () => {
      const root = makeRootDelegate("realm-1", "dlg-root");
      await db.create(root);

      await db.revoke("dlg-root", "admin");
      const result = await db.revoke("dlg-root", "admin");
      expect(result).toBe(false);
    });

    it("returns false for non-existent delegate", async () => {
      const result = await db.revoke("non-existent", "admin");
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // listChildren
  // --------------------------------------------------------------------------

  describe("listChildren", () => {
    it("lists children of a parent delegate", async () => {
      const root = makeRootDelegate("realm-1", "dlg-root");
      const child1 = makeChildDelegate("realm-1", "dlg-a", "dlg-root", ["dlg-root"]);
      const child2 = makeChildDelegate("realm-1", "dlg-b", "dlg-root", ["dlg-root"]);

      await db.create(root);
      await db.create(child1);
      await db.create(child2);

      const result = await db.listChildren("dlg-root");
      expect(result.delegates.length).toBe(2);
      const ids = result.delegates.map((d) => d.delegateId).sort();
      expect(ids).toEqual(["dlg-a", "dlg-b"]);
    });

    it("returns empty for parent with no children", async () => {
      const root = makeRootDelegate("realm-1", "dlg-root");
      await db.create(root);

      const result = await db.listChildren("dlg-root");
      expect(result.delegates.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getOrCreateRoot
  // --------------------------------------------------------------------------

  describe("getOrCreateRoot", () => {
    it("creates a new root delegate", async () => {
      const tokenHashes = {
        currentRtHash: "a".repeat(32),
        currentAtHash: "b".repeat(32),
        atExpiresAt: Date.now() + 3600_000,
      };
      const { delegate: root, created } = await db.getOrCreateRoot("realm-1", "dlg-new-root", tokenHashes);
      expect(created).toBe(true);
      expect(root.delegateId).toBe("dlg-new-root");
      expect(root.realm).toBe("realm-1");
      expect(root.parentId).toBeNull();
      expect(root.depth).toBe(0);
      expect(root.chain).toEqual(["dlg-new-root"]);
      expect(root.canUpload).toBe(true);
      expect(root.canManageDepot).toBe(true);
    });

    it("returns existing root on second call", async () => {
      const tokenHashes1 = {
        currentRtHash: "a".repeat(32),
        currentAtHash: "b".repeat(32),
        atExpiresAt: Date.now() + 3600_000,
      };
      const tokenHashes2 = {
        currentRtHash: "c".repeat(32),
        currentAtHash: "d".repeat(32),
        atExpiresAt: Date.now() + 3600_000,
      };
      const { delegate: _root1, created: created1 } = await db.getOrCreateRoot("realm-1", "dlg-root-1", tokenHashes1);
      expect(created1).toBe(true);
      const { delegate: root2, created: created2 } = await db.getOrCreateRoot("realm-1", "dlg-root-2", tokenHashes2);

      // Should return the same root (first one created)
      expect(created2).toBe(false);
      expect(root2.delegateId).toBe("dlg-root-1");
    });
  });
});
