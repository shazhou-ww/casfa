# @casfa/proof

X-CAS-Proof header parsing, verification, and formatting for the CASFA authorization system.

## Overview

This package provides pure functions for working with the `X-CAS-Proof` header — the mechanism by which delegates prove they can access specific CAS nodes within their scope tree.

**Zero runtime dependencies. No I/O.** All I/O operations are injected via the `ProofVerificationContext` callback interface.

## Proof Format

```http
X-CAS-Proof: {"abc123":"ipath#0:1:2","def456":"depot:DEPOT_ID@VERSION#0:3"}
```

### ProofWord Types

| Type | Format | Description |
|------|--------|-------------|
| `ipath` | `ipath#<scopeIndex>:<path...>` | Navigate from delegate scope root |
| `depot` | `depot:<depotId>@<version>#<path...>` | Navigate from depot version root |

## Usage

```typescript
import {
  parseProofHeader,
  verifyNodeAccess,
  formatProofHeader,
  ipath,
  depot,
} from "@casfa/proof";

// Parse header
const proofMap = parseProofHeader(request.headers["x-cas-proof"]);

// Verify access (server-side)
const result = await verifyNodeAccess(nodeHash, delegateId, proofMap, {
  hasOwnership: async (hash, id) => { /* O(1) DB lookup */ },
  isRootDelegate: async (id) => { /* check DB */ },
  getScopeRoots: async (id) => { /* resolve scope */ },
  resolveNode: async (hash) => { /* read CAS node */ },
  resolveDepotVersion: async (depotId, ver) => { /* resolve version root */ },
  hasDepotAccess: async (id, depotId) => { /* check depot permission */ },
});

// Build header (client-side)
const header = formatProofHeader([
  ["abc123", ipath(0, 1, 2)],
  ["def456", depot("myDepot", "v1", 0, 3)],
]);
```

## Verification Flow

1. **Ownership** — O(1) GetItem check (full-chain ownership)
2. **Root delegate** — unrestricted access, skip proof
3. **Proof walk** — parse ProofWord, walk CAS DAG, compare final hash
