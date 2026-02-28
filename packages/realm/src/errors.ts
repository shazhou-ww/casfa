/**
 * Realm layer error type.
 * Use Result or throw with this shape; do not throw generic Error.
 */
export type RealmErrorCode = "NotFound" | "InvalidPath" | "CommitConflict" | "NoRoot";

export type RealmError = {
  code: RealmErrorCode;
  message?: string;
};

export function isRealmError(x: unknown): x is RealmError {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const code = o.code;
  return (
    code === "NotFound" ||
    code === "InvalidPath" ||
    code === "CommitConflict" ||
    code === "NoRoot"
  );
}
