import { createRealmFacade } from "@casfa/realm";
import type { DelegateStore, RealmFacade } from "@casfa/realm";
import type { CasFacade } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import type { ServerConfig } from "../config.ts";

export function createRealmFacadeFromConfig(
  cas: CasFacade,
  key: KeyProvider,
  config: ServerConfig,
  delegateStore: DelegateStore
): RealmFacade {
  return createRealmFacade({
    cas,
    delegateStore,
    key,
    maxLimitedTtlMs: config.auth.maxBranchTtlMs,
  });
}
