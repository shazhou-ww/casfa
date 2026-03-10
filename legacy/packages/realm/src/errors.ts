export type RealmErrorCode = "NotFound" | "InvalidPath" | "CommitConflict";

export type RealmError = {
  readonly name: "RealmError";
  readonly code: RealmErrorCode;
  message: string;
};

export function createRealmError(code: RealmErrorCode, message?: string): RealmError {
  return { name: "RealmError", code, message: message ?? code };
}

export function isRealmError(x: unknown): x is RealmError {
  return (
    typeof x === "object" &&
    x !== null &&
    "name" in x &&
    (x as RealmError).name === "RealmError" &&
    "code" in x
  );
}
