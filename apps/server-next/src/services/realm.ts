import { createMemoryDelegateStore } from "@casfa/realm";
import { createRealmFacade } from "@casfa/realm";
import type { CasFacade } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import type { RealmFacade } from "@casfa/realm";
import type { ServerConfig } from "../config.ts";

export function createRealmFacadeFromConfig(
  cas: CasFacade,
  key: KeyProvider,
  config: ServerConfig
): RealmFacade {
  const delegateStore = createMemoryDelegateStore();
  return createRealmFacade({
    cas,
    delegateStore,
    key,
    maxLimitedTtlMs: config.auth.maxBranchTtlMs,
  });
}
