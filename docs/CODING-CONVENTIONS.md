# CASFA Coding Conventions

Agents and contributors should follow these conventions when writing or modifying code in this repo.

---

## Be explicit: avoid ambiguous definitions

- Prefer **explicit** types and APIs; avoid definitions that are ambiguous or “either A or B” without a clear single meaning.
- **Optional properties** (`?`): use only when the absence of the value has a clear meaning; otherwise prefer a required field or a separate type.
- **Union types** that mean “string or array of string” (or similar) are ambiguous—pick one representation and use it consistently (e.g. path as `string` only, not `string | string[]`).
- **Paths**: use **`string`** only (e.g. `"foo"`, `"foo/bar"`). Do **not** support a segments array (`string[]`) for the same concept; one representation keeps the code clear.

```ts
// Prefer: single, explicit type
type Delegate = { delegateId: string; mountPath: string };
function getNode(path: string): Promise<CasNode | null>;

// Avoid: optional or union when a single clear choice is better
type Delegate = { delegateId: string; mountPath?: string[] | string };
function getNode(path: string | string[]): Promise<CasNode | null>;
```

---

## Functional style

- Prefer **functional** style: pure functions, immutable data, avoid mutable shared state.
- Prefer **create functions** that return objects over constructors or classes (see below).

---

## Types: use `type`, not `interface`

- Use **`type`** for all data shapes and ADTs (algebraic data types).
- Do **not** use `interface` for new code; use `type` instead.

```ts
// Prefer
type User = { id: string; name: string };
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Avoid
interface User { id: string; name: string; }
```

---

## No classes: use create functions

- Do **not** use `class` for service objects or “modules”.
- Use a **create function** that takes dependencies and returns a plain object (or record of functions).

```ts
// Prefer
type CasService = ReturnType<typeof createCasService>;
function createCasService(ctx: CasContext) {
  return {
    getNode(key: string) { ... },
    putNode(nodeKey: string, data: Uint8Array) { ... },
  };
}

// Avoid
class CasService {
  constructor(private ctx: CasContext) {}
  getNode(key: string) { ... }
}
```

- For **errors**, use a **type** (discriminated union or branded object) and a **create function**, not a class that extends `Error`.

```ts
// Prefer
type CasError = { readonly name: "CasError"; readonly code: CasErrorCode; message: string };
function createCasError(code: CasErrorCode, message?: string): CasError {
  return { name: "CasError", code, message: message ?? code };
}

// Avoid
class CasError extends Error { ... }
```

---

## Summary

| Prefer | Avoid |
|--------|--------|
| `type` for ADT and data shapes | `interface` |
| Create functions returning objects | `class` |
| Functional style, pure functions | Mutable state, OO constructors |
| Explicit types, one representation (e.g. path as `string`) | Optional / union types that are ambiguous (e.g. `string \| string[]`) |
