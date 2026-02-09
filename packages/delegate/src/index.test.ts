import { describe, expect, it } from "bun:test";

import {
  MAX_DEPTH,
  ROOT_DEPTH,
  buildChain,
  buildRootChain,
  chainDepth,
  isAncestor,
  isChainValid,
  isDirectChildChain,
  validateCreateDelegate,
  validateDelegatedDepots,
  validateDepth,
  validateExpiresAt,
  validatePermissions,
} from "./index.ts";

import type {
  CreateDelegateInput,
  DelegatePermissions,
} from "./types.ts";

// ============================================================================
// Helper factories
// ============================================================================

function rootPerms(overrides?: Partial<DelegatePermissions>): DelegatePermissions {
  return {
    canUpload: true,
    canManageDepot: true,
    depth: 0,
    ...overrides,
  };
}

function childInput(overrides?: Partial<CreateDelegateInput>): CreateDelegateInput {
  return {
    canUpload: true,
    canManageDepot: true,
    ...overrides,
  };
}

// ============================================================================
// Constants
// ============================================================================

describe("constants", () => {
  it("MAX_DEPTH is 15", () => {
    expect(MAX_DEPTH).toBe(15);
  });

  it("ROOT_DEPTH is 0", () => {
    expect(ROOT_DEPTH).toBe(0);
  });
});

// ============================================================================
// Chain utilities
// ============================================================================

describe("chain", () => {
  describe("buildRootChain", () => {
    it("returns [selfId] for root", () => {
      expect(buildRootChain("root")).toEqual(["root"]);
    });
  });

  describe("buildChain", () => {
    it("appends childId to parent chain", () => {
      expect(buildChain(["root"], "child-a")).toEqual(["root", "child-a"]);
    });

    it("builds multi-level chain", () => {
      const lvl1 = buildChain(["root"], "a");
      const lvl2 = buildChain(lvl1, "b");
      const lvl3 = buildChain(lvl2, "c");
      expect(lvl3).toEqual(["root", "a", "b", "c"]);
    });

    it("does not mutate the parent chain", () => {
      const parent = ["root", "a"];
      const child = buildChain(parent, "b");
      expect(parent).toEqual(["root", "a"]);
      expect(child).toEqual(["root", "a", "b"]);
    });
  });

  describe("isAncestor", () => {
    const chain = ["root", "a", "b", "c"];

    it("root is ancestor", () => {
      expect(isAncestor("root", chain)).toBe(true);
    });

    it("intermediate is ancestor", () => {
      expect(isAncestor("a", chain)).toBe(true);
    });

    it("self is ancestor (inclusive)", () => {
      expect(isAncestor("c", chain)).toBe(true);
    });

    it("unknown ID is not ancestor", () => {
      expect(isAncestor("unknown", chain)).toBe(false);
    });

    it("empty chain → always false", () => {
      expect(isAncestor("root", [])).toBe(false);
    });
  });

  describe("chainDepth", () => {
    it("root chain has depth 0", () => {
      expect(chainDepth(["root"])).toBe(0);
    });

    it("depth 1 for two-element chain", () => {
      expect(chainDepth(["root", "a"])).toBe(1);
    });

    it("depth 15 for 16-element chain", () => {
      const chain = Array.from({ length: 16 }, (_, i) => `d${i}`);
      expect(chainDepth(chain)).toBe(15);
    });
  });

  describe("isChainValid", () => {
    it("valid root chain", () => {
      expect(isChainValid(["root"])).toBe(true);
    });

    it("valid multi-level chain", () => {
      expect(isChainValid(["root", "a", "b"])).toBe(true);
    });

    it("max depth (16 elements) is valid", () => {
      const chain = Array.from({ length: 16 }, (_, i) => `d${i}`);
      expect(isChainValid(chain)).toBe(true);
    });

    it("rejects empty chain", () => {
      expect(isChainValid([])).toBe(false);
    });

    it("rejects chain exceeding MAX_DEPTH+1 elements", () => {
      const chain = Array.from({ length: 17 }, (_, i) => `d${i}`);
      expect(isChainValid(chain)).toBe(false);
    });

    it("rejects chain with duplicate IDs", () => {
      expect(isChainValid(["root", "a", "root"])).toBe(false);
    });

    it("rejects chain with empty string", () => {
      expect(isChainValid(["root", ""])).toBe(false);
    });
  });

  describe("isDirectChildChain", () => {
    it("valid: parent=[root], child=[root, a]", () => {
      expect(isDirectChildChain(["root"], ["root", "a"])).toBe(true);
    });

    it("valid: parent=[root, a], child=[root, a, b]", () => {
      expect(isDirectChildChain(["root", "a"], ["root", "a", "b"])).toBe(true);
    });

    it("rejects: same length chains", () => {
      expect(isDirectChildChain(["root"], ["root"])).toBe(false);
    });

    it("rejects: child chain two levels deeper", () => {
      expect(isDirectChildChain(["root"], ["root", "a", "b"])).toBe(false);
    });

    it("rejects: prefix mismatch", () => {
      expect(isDirectChildChain(["root", "x"], ["root", "a", "b"])).toBe(false);
    });
  });
});

// ============================================================================
// Validation: permissions
// ============================================================================

describe("validatePermissions", () => {
  it("allows equal permissions", () => {
    const parent = rootPerms();
    const result = validatePermissions(parent, childInput());
    expect(result.valid).toBe(true);
  });

  it("allows reduced permissions", () => {
    const parent = rootPerms();
    const result = validatePermissions(
      parent,
      childInput({ canUpload: false, canManageDepot: false }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects canUpload escalation", () => {
    const parent = rootPerms({ canUpload: false });
    const result = validatePermissions(parent, childInput({ canUpload: true }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("PERMISSION_ESCALATION");
      expect(result.message).toContain("canUpload");
    }
  });

  it("rejects canManageDepot escalation", () => {
    const parent = rootPerms({ canManageDepot: false });
    const result = validatePermissions(
      parent,
      childInput({ canManageDepot: true }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("PERMISSION_ESCALATION");
      expect(result.message).toContain("canManageDepot");
    }
  });

  it("allows false → false for both", () => {
    const parent = rootPerms({ canUpload: false, canManageDepot: false });
    const result = validatePermissions(
      parent,
      childInput({ canUpload: false, canManageDepot: false }),
    );
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Validation: depth
// ============================================================================

describe("validateDepth", () => {
  it("allows depth 0 → 1", () => {
    expect(validateDepth(0).valid).toBe(true);
  });

  it("allows depth 14 → 15 (max)", () => {
    expect(validateDepth(14).valid).toBe(true);
  });

  it("rejects depth 15 → 16 (exceeds MAX_DEPTH)", () => {
    const result = validateDepth(15);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("DEPTH_EXCEEDED");
    }
  });

  it("rejects depth 100 → 101", () => {
    const result = validateDepth(100);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("DEPTH_EXCEEDED");
    }
  });
});

// ============================================================================
// Validation: expiresAt
// ============================================================================

describe("validateExpiresAt", () => {
  it("allows anything when parent has no expiresAt", () => {
    expect(validateExpiresAt(undefined, undefined).valid).toBe(true);
    expect(validateExpiresAt(undefined, 9999999).valid).toBe(true);
  });

  it("rejects child with no expiresAt when parent expires", () => {
    const result = validateExpiresAt(1000, undefined);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("EXPIRES_AFTER_PARENT");
      expect(result.message).toContain("outlive");
    }
  });

  it("allows child expiresAt == parent expiresAt", () => {
    expect(validateExpiresAt(1000, 1000).valid).toBe(true);
  });

  it("allows child expiresAt < parent expiresAt", () => {
    expect(validateExpiresAt(2000, 1000).valid).toBe(true);
  });

  it("rejects child expiresAt > parent expiresAt", () => {
    const result = validateExpiresAt(1000, 2000);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("EXPIRES_AFTER_PARENT");
    }
  });
});

// ============================================================================
// Validation: delegatedDepots
// ============================================================================

describe("validateDelegatedDepots", () => {
  const parentDepots = new Set(["depot-1", "depot-2", "depot-3"]);

  it("allows undefined (no delegation)", () => {
    expect(validateDelegatedDepots(parentDepots, undefined).valid).toBe(true);
  });

  it("allows empty array", () => {
    expect(validateDelegatedDepots(parentDepots, []).valid).toBe(true);
  });

  it("allows subset of parent's manageable depots", () => {
    expect(
      validateDelegatedDepots(parentDepots, ["depot-1", "depot-3"]).valid,
    ).toBe(true);
  });

  it("allows all of parent's manageable depots", () => {
    expect(
      validateDelegatedDepots(parentDepots, ["depot-1", "depot-2", "depot-3"])
        .valid,
    ).toBe(true);
  });

  it("rejects depot not in parent's range", () => {
    const result = validateDelegatedDepots(parentDepots, [
      "depot-1",
      "depot-unknown",
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("DELEGATED_DEPOTS_ESCALATION");
      expect(result.message).toContain("depot-unknown");
    }
  });

  it("rejects when parent has no depots", () => {
    const result = validateDelegatedDepots(new Set(), ["depot-1"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("DELEGATED_DEPOTS_ESCALATION");
    }
  });
});

// ============================================================================
// Validation: composite validateCreateDelegate
// ============================================================================

describe("validateCreateDelegate", () => {
  it("passes with valid root → child creation", () => {
    const parent = rootPerms();
    const input = childInput({ canUpload: true, canManageDepot: false });
    const result = validateCreateDelegate(parent, input, new Set());
    expect(result.valid).toBe(true);
  });

  it("fails on depth exceeded first", () => {
    const parent = rootPerms({ depth: MAX_DEPTH });
    const input = childInput();
    const result = validateCreateDelegate(parent, input, new Set());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("DEPTH_EXCEEDED");
  });

  it("fails on permission escalation", () => {
    const parent = rootPerms({ canUpload: false });
    const input = childInput({ canUpload: true });
    const result = validateCreateDelegate(parent, input, new Set());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("PERMISSION_ESCALATION");
  });

  it("fails on expiresAt violation", () => {
    const parent = rootPerms({ expiresAt: 1000 });
    const input = childInput({ expiresAt: 2000 });
    const result = validateCreateDelegate(parent, input, new Set());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("EXPIRES_AFTER_PARENT");
  });

  it("fails on delegatedDepots escalation", () => {
    const parent = rootPerms();
    const input = childInput({ delegatedDepots: ["depot-x"] });
    const result = validateCreateDelegate(parent, input, new Set(["depot-a"]));
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.error).toBe("DELEGATED_DEPOTS_ESCALATION");
  });

  it("passes full scenario: depth=2, reduced perms, valid depots, valid expiresAt", () => {
    const parent: DelegatePermissions = {
      canUpload: true,
      canManageDepot: true,
      depth: 2,
      expiresAt: 5000,
    };
    const input = childInput({
      canUpload: true,
      canManageDepot: false,
      delegatedDepots: ["depot-1"],
      expiresAt: 3000,
    });
    const result = validateCreateDelegate(
      parent,
      input,
      new Set(["depot-1", "depot-2"]),
    );
    expect(result.valid).toBe(true);
  });

  it("passes: readonly child at depth 14 → 15 (max allowed)", () => {
    const parent: DelegatePermissions = {
      canUpload: false,
      canManageDepot: false,
      depth: 14,
    };
    const input = childInput({ canUpload: false, canManageDepot: false });
    const result = validateCreateDelegate(parent, input, new Set());
    expect(result.valid).toBe(true);
  });
});
