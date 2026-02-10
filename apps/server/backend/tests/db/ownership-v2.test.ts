/**
 * Unit tests for Ownership V2 DB module
 *
 * Tests the delegate-chain-based ownership model:
 * - Full-chain writes (BatchWriteItem)
 * - O(1) GetItem lookups
 * - Ancestor vs sibling ownership checks
 * - Idempotent re-uploads
 * - Boundary cases (depth 1 to depth 16)
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createOwnershipV2Db, type OwnershipV2Db } from "../../src/db/ownership-v2.ts";

// ============================================================================
// In-memory DynamoDB mock (pk/sk composite key table)
// ============================================================================

type Item = Record<string, unknown>;

function createMockDynamoClient() {
  const items: Map<string, Item> = new Map();

  /** Build composite key from pk + sk */
  const compositeKey = (pk: string, sk: string) => `${pk}||${sk}`;

  const send = mock(async (command: unknown) => {
    const cmd = command as {
      input: Record<string, unknown>;
      constructor: { name: string };
    };
    const cmdName = cmd.constructor.name;

    if (cmdName === "BatchWriteCommand") {
      const input = cmd.input as {
        RequestItems: Record<string, Array<{ PutRequest: { Item: Item } }>>;
      };
      for (const [, requests] of Object.entries(input.RequestItems)) {
        for (const req of requests) {
          const item = req.PutRequest.Item;
          const pk = item.pk as string;
          const sk = item.sk as string;
          items.set(compositeKey(pk, sk), { ...item });
        }
      }
      return {};
    }

    if (cmdName === "GetCommand") {
      const input = cmd.input as {
        Key: { pk: string; sk: string };
        ProjectionExpression?: string;
      };
      const cKey = compositeKey(input.Key.pk, input.Key.sk);
      const item = items.get(cKey);
      return { Item: item ?? undefined };
    }

    if (cmdName === "QueryCommand") {
      const input = cmd.input as {
        ExpressionAttributeValues?: Record<string, unknown>;
        Limit?: number;
        ProjectionExpression?: string;
      };
      const vals = input.ExpressionAttributeValues ?? {};
      const pkValue = vals[":pk"] as string | undefined;

      const matching: Item[] = [];
      for (const [_key, item] of items.entries()) {
        if (pkValue && item.pk === pkValue) {
          matching.push(item);
        }
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
// Tests
// ============================================================================

describe("OwnershipV2Db", () => {
  let db: OwnershipV2Db;
  let mockClient: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    mockClient = createMockDynamoClient();
    db = createOwnershipV2Db({
      tableName: "test-tokens-table",
      client: mockClient as never,
    });
  });

  // --------------------------------------------------------------------------
  // addOwnership + hasOwnership — full-chain write + O(1) lookup
  // --------------------------------------------------------------------------

  describe("full-chain write + O(1) lookup", () => {
    it("root delegate (depth 0, chain=[root]) — writes 1 record", async () => {
      const chain = ["dlg-root"];
      await db.addOwnership("nodeX", chain, "dlg-root", "application/octet-stream", 1024, "file");

      expect(await db.hasOwnership("nodeX", "dlg-root")).toBe(true);
    });

    it("depth 1 — child upload, both child and root own it", async () => {
      const chain = ["dlg-root", "dlg-a"];
      await db.addOwnership("nodeX", chain, "dlg-a", "application/octet-stream", 512, "file");

      expect(await db.hasOwnership("nodeX", "dlg-root")).toBe(true);
      expect(await db.hasOwnership("nodeX", "dlg-a")).toBe(true);
    });

    it("depth 2 — grandchild upload, all ancestors own it", async () => {
      const chain = ["dlg-root", "dlg-aaa", "dlg-a1"];
      await db.addOwnership("nodeX", chain, "dlg-a1", "application/octet-stream", 2048, "dict");

      expect(await db.hasOwnership("nodeX", "dlg-root")).toBe(true);
      expect(await db.hasOwnership("nodeX", "dlg-aaa")).toBe(true);
      expect(await db.hasOwnership("nodeX", "dlg-a1")).toBe(true);
    });

    it("sibling does NOT own the node", async () => {
      const chain = ["dlg-root", "dlg-aaa", "dlg-a1"];
      await db.addOwnership("nodeX", chain, "dlg-a1", "application/octet-stream", 1024);

      // dlg-bbb is a sibling of dlg-aaa, not in the chain
      expect(await db.hasOwnership("nodeX", "dlg-bbb")).toBe(false);
    });

    it("cousin does NOT own the node", async () => {
      // dlg-a1 uploads via chain [root, aaa, a1]
      await db.addOwnership(
        "nodeX",
        ["dlg-root", "dlg-aaa", "dlg-a1"],
        "dlg-a1",
        "application/octet-stream",
        1024
      );

      // dlg-b1 is a cousin (under dlg-bbb, not dlg-aaa)
      expect(await db.hasOwnership("nodeX", "dlg-b1")).toBe(false);
      expect(await db.hasOwnership("nodeX", "dlg-bbb")).toBe(false);
    });

    it("root owns nodes from both branches (via separate uploads)", async () => {
      // Branch A uploads nodeX
      await db.addOwnership(
        "nodeX",
        ["dlg-root", "dlg-aaa"],
        "dlg-aaa",
        "application/octet-stream",
        1024
      );
      // Branch B uploads nodeY
      await db.addOwnership(
        "nodeY",
        ["dlg-root", "dlg-bbb"],
        "dlg-bbb",
        "application/octet-stream",
        2048
      );

      // Root owns both
      expect(await db.hasOwnership("nodeX", "dlg-root")).toBe(true);
      expect(await db.hasOwnership("nodeY", "dlg-root")).toBe(true);

      // Cross-branch does NOT work
      expect(await db.hasOwnership("nodeX", "dlg-bbb")).toBe(false);
      expect(await db.hasOwnership("nodeY", "dlg-aaa")).toBe(false);
    });

    it("depth 15 (max) — writes 16 records, all ancestors own it", async () => {
      const chain = Array.from({ length: 16 }, (_, i) => `dlg-${i}`);
      await db.addOwnership("nodeDeep", chain, "dlg-15", "application/octet-stream", 100, "file");

      // All 16 delegates should own it
      for (const delegateId of chain) {
        expect(await db.hasOwnership("nodeDeep", delegateId)).toBe(true);
      }

      // Non-chain delegate should NOT
      expect(await db.hasOwnership("nodeDeep", "dlg-outsider")).toBe(false);
    });

    it("empty chain — no-op (no records written)", async () => {
      await db.addOwnership("nodeX", [], "nobody", "application/octet-stream", 0);

      expect(await db.hasOwnership("nodeX", "nobody")).toBe(false);
      expect(await db.hasAnyOwnership("nodeX")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Idempotent re-upload
  // --------------------------------------------------------------------------

  describe("idempotent re-upload", () => {
    it("same delegate re-uploading same node — overwrites silently", async () => {
      const chain = ["dlg-root", "dlg-a"];

      await db.addOwnership("nodeX", chain, "dlg-a", "text/plain", 100, "file");
      await db.addOwnership("nodeX", chain, "dlg-a", "text/html", 200, "file");

      // Still owns it
      expect(await db.hasOwnership("nodeX", "dlg-root")).toBe(true);
      expect(await db.hasOwnership("nodeX", "dlg-a")).toBe(true);

      // The second write's metadata is stored
      const record = await db.getOwnership("nodeX", "dlg-a");
      expect(record).not.toBeNull();
      expect(record!.contentType).toBe("text/html");
      expect(record!.size).toBe(200);
    });

    it("different delegate uploading same node — both chains written independently", async () => {
      // dlg-a uploads nodeX
      await db.addOwnership(
        "nodeX",
        ["dlg-root", "dlg-a"],
        "dlg-a",
        "application/octet-stream",
        1024
      );
      // dlg-b uploads the same nodeX (CAS — same content hash)
      await db.addOwnership(
        "nodeX",
        ["dlg-root", "dlg-b"],
        "dlg-b",
        "application/octet-stream",
        1024
      );

      // Root is in both chains
      expect(await db.hasOwnership("nodeX", "dlg-root")).toBe(true);
      // Both delegates own it
      expect(await db.hasOwnership("nodeX", "dlg-a")).toBe(true);
      expect(await db.hasOwnership("nodeX", "dlg-b")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // hasAnyOwnership
  // --------------------------------------------------------------------------

  describe("hasAnyOwnership", () => {
    it("returns true when node has ownership records", async () => {
      await db.addOwnership("nodeX", ["dlg-root"], "dlg-root", "application/octet-stream", 1024);
      expect(await db.hasAnyOwnership("nodeX")).toBe(true);
    });

    it("returns false when node has no ownership records", async () => {
      expect(await db.hasAnyOwnership("nodeUnknown")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getOwnership
  // --------------------------------------------------------------------------

  describe("getOwnership", () => {
    it("returns the ownership record with correct metadata", async () => {
      const chain = ["dlg-root", "dlg-a"];
      await db.addOwnership("nodeX", chain, "dlg-a", "image/png", 4096, "file");

      const record = await db.getOwnership("nodeX", "dlg-root");
      expect(record).not.toBeNull();
      expect(record!.uploadedBy).toBe("dlg-a");
      expect(record!.kind).toBe("file");
      expect(record!.size).toBe(4096);
      expect(record!.contentType).toBe("image/png");
      expect(record!.createdAt).toBeGreaterThan(0);
    });

    it("returns null for non-existent node", async () => {
      expect(await db.getOwnership("nodeUnknown", "dlg-root")).toBeNull();
    });

    it("returns null for non-owner delegate", async () => {
      await db.addOwnership(
        "nodeX",
        ["dlg-root", "dlg-a"],
        "dlg-a",
        "application/octet-stream",
        1024
      );
      expect(await db.getOwnership("nodeX", "dlg-b")).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // listOwners
  // --------------------------------------------------------------------------

  describe("listOwners", () => {
    it("lists all delegates that own a node", async () => {
      const chain = ["dlg-root", "dlg-aaa", "dlg-a1"];
      await db.addOwnership("nodeX", chain, "dlg-a1", "application/octet-stream", 1024);

      const owners = await db.listOwners("nodeX");
      expect(owners.sort()).toEqual(["dlg-a1", "dlg-aaa", "dlg-root"]);
    });

    it("includes owners from multiple uploaders", async () => {
      await db.addOwnership("nodeX", ["dlg-root", "dlg-a"], "dlg-a", "text/plain", 100);
      await db.addOwnership("nodeX", ["dlg-root", "dlg-b"], "dlg-b", "text/plain", 100);

      const owners = await db.listOwners("nodeX");
      // dlg-root appears via both chains but stored under same PK+SK so it's one record
      expect(owners.sort()).toEqual(["dlg-a", "dlg-b", "dlg-root"]);
    });

    it("returns empty for non-existent node", async () => {
      const owners = await db.listOwners("nodeUnknown");
      expect(owners).toEqual([]);
    });
  });
});
