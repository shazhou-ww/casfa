import { encodeCB32 } from "@casfa/encoding";

const DELEGATE_ID_PREFIX = "dlg_";

/**
 * Generate a new delegate ID: dlg_ + Crockford Base32(128-bit random).
 */
export function generateDelegateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return DELEGATE_ID_PREFIX + encodeCB32(bytes);
}
