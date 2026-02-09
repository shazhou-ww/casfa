/**
 * Unit tests for TokenRecords DB module
 *
 * Tests the token records database layer using mocked DynamoDB client.
 * Tests cover: create, get, markUsed (atomic), invalidateFamily, listByDelegate.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createTokenRecordsDb,
  type CreateTokenRecordInput,
  type TokenRecordsDb,
} from "../../src/db/token-records.ts";

// ============================================================================
// In-memory DynamoDB mock (pk/sk composite key table)
// ============================================================================

type Item = Record<string, unknown>;

/**
 * Simple in-memory DynamoDB mock that supports:
 * - PutCommand
 * - GetCommand
 * - UpdateCommand (with ConditionExpression)
 * - QueryCommand (on gsi1 and gsi2)
 */
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

    if (cmdName === "PutCommand") {
      const input = cmd.input as { Item: Item };
      const item = input.Item;
      const pk = item.pk as string;
      const sk = item.sk as string;
      items.set(compositeKey(pk, sk), { ...item });
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

      // Evaluate ConditionExpression
      if (input.ConditionExpression) {
        if (!item) {
          const error = new Error("Condition not met");
          (error as unknown as { name: string }).name =
            "ConditionalCheckFailedException";
          throw error;
        }

        // markUsed: attribute_exists(pk) AND isUsed = :false AND isInvalidated = :false
        if (
          input.ConditionExpression.includes("isUsed = :false") &&
          item.isUsed === true
        ) {
          const error = new Error("Condition not met");
          (error as unknown as { name: string }).name =
            "ConditionalCheckFailedException";
          throw error;
        }

        if (
          input.ConditionExpression.includes("isInvalidated = :false") &&
          item.isInvalidated === true
        ) {
          const error = new Error("Condition not met");
          (error as unknown as { name: string }).name =
            "ConditionalCheckFailedException";
          throw error;
        }
      }

      if (item && input.ExpressionAttributeValues) {
        const vals = input.ExpressionAttributeValues;
        // SET isUsed = :true
        if (input.UpdateExpression.includes("isUsed = :true")) {
          item.isUsed = vals[":true"] ?? true;
        }
        // SET isInvalidated = :true
        if (input.UpdateExpression.includes("isInvalidated = :true")) {
          item.isInvalidated = vals[":true"] ?? true;
        }
        items.set(cKey, item);
      }
      return {};
    }

    if (cmdName === "QueryCommand") {
      const input = cmd.input as {
        IndexName?: string;
        KeyConditionExpression?: string;
        ExpressionAttributeValues?: Record<string, unknown>;
        Limit?: number;
        ExclusiveStartKey?: Record<string, unknown>;
      };

      const vals = input.ExpressionAttributeValues ?? {};
      const matching: Item[] = [];

      if (input.IndexName === "gsi1") {
        // Family query: gsi1pk = :pk
        const gsi1pkValue = vals[":pk"] as string;
        for (const item of items.values()) {
          if (item.gsi1pk === gsi1pkValue) {
            matching.push(item);
          }
        }
      } else if (input.IndexName === "gsi2") {
        // Delegate query: gsi2pk = :pk
        const gsi2pkValue = vals[":pk"] as string;
        for (const item of items.values()) {
          if (item.gsi2pk === gsi2pkValue) {
            matching.push(item);
          }
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
// Helpers
// ============================================================================

function makeTokenInput(overrides?: Partial<CreateTokenRecordInput>): CreateTokenRecordInput {
  return {
    tokenId: "dlt1_abc123",
    tokenType: "refresh",
    delegateId: "dlg-001",
    realm: "usr_user1",
    expiresAt: 0,
    familyId: "fam-001",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("TokenRecordsDb", () => {
  let db: TokenRecordsDb;
  let mockClient: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    mockClient = createMockDynamoClient();
    db = createTokenRecordsDb({
      tableName: "test-tokens-table",
      client: mockClient as never,
    });
  });

  // --------------------------------------------------------------------------
  // create + get
  // --------------------------------------------------------------------------

  describe("create + get", () => {
    it("creates and retrieves a refresh token record", async () => {
      const input = makeTokenInput();
      await db.create(input);

      const record = await db.get("dlt1_abc123");
      expect(record).not.toBeNull();
      expect(record!.tokenId).toBe("dlt1_abc123");
      expect(record!.tokenType).toBe("refresh");
      expect(record!.delegateId).toBe("dlg-001");
      expect(record!.realm).toBe("usr_user1");
      expect(record!.expiresAt).toBe(0);
      expect(record!.isUsed).toBe(false);
      expect(record!.isInvalidated).toBe(false);
      expect(record!.familyId).toBe("fam-001");
      expect(record!.createdAt).toBeGreaterThan(0);
    });

    it("creates and retrieves an access token record", async () => {
      const expiresAt = Date.now() + 3600_000;
      const input = makeTokenInput({
        tokenId: "dlt1_at456",
        tokenType: "access",
        expiresAt,
      });
      await db.create(input);

      const record = await db.get("dlt1_at456");
      expect(record).not.toBeNull();
      expect(record!.tokenType).toBe("access");
      expect(record!.expiresAt).toBe(expiresAt);
    });

    it("returns null for non-existent token", async () => {
      const record = await db.get("dlt1_nonexistent");
      expect(record).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // markUsed (atomic one-time-use)
  // --------------------------------------------------------------------------

  describe("markUsed", () => {
    it("marks an unused RT as used (returns true)", async () => {
      await db.create(makeTokenInput());

      const success = await db.markUsed("dlt1_abc123");
      expect(success).toBe(true);

      const record = await db.get("dlt1_abc123");
      expect(record!.isUsed).toBe(true);
    });

    it("returns false when RT is already used (atomic guard)", async () => {
      await db.create(makeTokenInput());

      // First mark — succeeds
      const first = await db.markUsed("dlt1_abc123");
      expect(first).toBe(true);

      // Second mark — fails atomically
      const second = await db.markUsed("dlt1_abc123");
      expect(second).toBe(false);
    });

    it("returns false for non-existent token", async () => {
      const success = await db.markUsed("dlt1_ghost");
      expect(success).toBe(false);
    });

    it("returns false for already-invalidated token", async () => {
      await db.create(makeTokenInput({ familyId: "fam-inv" }));
      // Invalidate via family
      await db.invalidateFamily("fam-inv");

      // Now markUsed should fail because isInvalidated = true
      const success = await db.markUsed("dlt1_abc123");
      expect(success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // invalidateFamily
  // --------------------------------------------------------------------------

  describe("invalidateFamily", () => {
    it("invalidates all tokens in a family", async () => {
      // Create 3 tokens in the same family
      await db.create(makeTokenInput({ tokenId: "dlt1_rt1", tokenType: "refresh", familyId: "fam-x" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_at1", tokenType: "access", familyId: "fam-x" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_rt2", tokenType: "refresh", familyId: "fam-x" }));

      const count = await db.invalidateFamily("fam-x");
      expect(count).toBe(3);

      // All should be invalidated
      const rt1 = await db.get("dlt1_rt1");
      const at1 = await db.get("dlt1_at1");
      const rt2 = await db.get("dlt1_rt2");
      expect(rt1!.isInvalidated).toBe(true);
      expect(at1!.isInvalidated).toBe(true);
      expect(rt2!.isInvalidated).toBe(true);
    });

    it("returns 0 for non-existent family", async () => {
      const count = await db.invalidateFamily("fam-nonexistent");
      expect(count).toBe(0);
    });

    it("does not affect tokens in other families", async () => {
      await db.create(makeTokenInput({ tokenId: "dlt1_a", familyId: "fam-A" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_b", familyId: "fam-B" }));

      await db.invalidateFamily("fam-A");

      const a = await db.get("dlt1_a");
      const b = await db.get("dlt1_b");
      expect(a!.isInvalidated).toBe(true);
      expect(b!.isInvalidated).toBe(false);
    });

    it("idempotent — re-invalidating already-invalidated family returns 0", async () => {
      await db.create(makeTokenInput({ tokenId: "dlt1_x", familyId: "fam-idem" }));

      const first = await db.invalidateFamily("fam-idem");
      expect(first).toBe(1);

      const second = await db.invalidateFamily("fam-idem");
      expect(second).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // listByDelegate
  // --------------------------------------------------------------------------

  describe("listByDelegate", () => {
    it("lists all tokens for a delegate", async () => {
      await db.create(makeTokenInput({ tokenId: "dlt1_r1", tokenType: "refresh", delegateId: "dlg-1" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_a1", tokenType: "access", delegateId: "dlg-1" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_r2", tokenType: "refresh", delegateId: "dlg-2" }));

      const result = await db.listByDelegate("dlg-1");
      expect(result.tokens.length).toBe(2);
      const ids = result.tokens.map((t) => t.tokenId).sort();
      expect(ids).toEqual(["dlt1_a1", "dlt1_r1"]);
    });

    it("returns empty for delegate with no tokens", async () => {
      const result = await db.listByDelegate("dlg-nonexistent");
      expect(result.tokens.length).toBe(0);
    });

    it("respects limit parameter", async () => {
      await db.create(makeTokenInput({ tokenId: "dlt1_t1", delegateId: "dlg-lim" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_t2", delegateId: "dlg-lim" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_t3", delegateId: "dlg-lim" }));

      const result = await db.listByDelegate("dlg-lim", { limit: 2 });
      expect(result.tokens.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Combined: RT rotation scenario
  // --------------------------------------------------------------------------

  describe("RT rotation scenario", () => {
    it("models a full RT rotation flow", async () => {
      // 1. Create initial RT + AT
      await db.create(makeTokenInput({ tokenId: "dlt1_rt_v1", tokenType: "refresh", familyId: "fam-rot" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_at_v1", tokenType: "access", familyId: "fam-rot" }));

      // 2. Use RT v1 → mark used
      const used = await db.markUsed("dlt1_rt_v1");
      expect(used).toBe(true);

      // 3. Issue RT v2 + AT v2
      await db.create(makeTokenInput({ tokenId: "dlt1_rt_v2", tokenType: "refresh", familyId: "fam-rot" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_at_v2", tokenType: "access", familyId: "fam-rot" }));

      // 4. Verify RT v1 cannot be reused
      const reuse = await db.markUsed("dlt1_rt_v1");
      expect(reuse).toBe(false);

      // 5. RT v2 is fresh
      const v2Record = await db.get("dlt1_rt_v2");
      expect(v2Record!.isUsed).toBe(false);
    });

    it("replay detection invalidates entire family", async () => {
      // Setup: RT v1 used, RT v2 issued
      await db.create(makeTokenInput({ tokenId: "dlt1_rt_v1", tokenType: "refresh", familyId: "fam-replay" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_at_v1", tokenType: "access", familyId: "fam-replay" }));
      await db.markUsed("dlt1_rt_v1");
      await db.create(makeTokenInput({ tokenId: "dlt1_rt_v2", tokenType: "refresh", familyId: "fam-replay" }));
      await db.create(makeTokenInput({ tokenId: "dlt1_at_v2", tokenType: "access", familyId: "fam-replay" }));

      // Attacker replays RT v1 — markUsed fails
      const replay = await db.markUsed("dlt1_rt_v1");
      expect(replay).toBe(false);

      // Server invalidates the entire family
      const count = await db.invalidateFamily("fam-replay");
      // RT v2 + AT v2 should be invalidated (RT v1 and AT v1 may also be, depending on isInvalidated state)
      expect(count).toBeGreaterThanOrEqual(2);

      // All tokens in family should be invalidated
      const rtV2 = await db.get("dlt1_rt_v2");
      const atV2 = await db.get("dlt1_at_v2");
      expect(rtV2!.isInvalidated).toBe(true);
      expect(atV2!.isInvalidated).toBe(true);
    });
  });
});
