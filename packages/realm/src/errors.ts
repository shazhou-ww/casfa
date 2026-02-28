export type RealmErrorCode = "NotFound" | "InvalidPath" | "CommitConflict";

export class RealmError extends Error {
  readonly code: RealmErrorCode;
  constructor(code: RealmErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RealmError";
    this.code = code;
    Object.setPrototypeOf(this, RealmError.prototype);
  }
}

export function isRealmError(x: unknown): x is RealmError {
  return x instanceof RealmError;
}
