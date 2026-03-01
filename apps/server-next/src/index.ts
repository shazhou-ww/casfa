import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMemoryDelegateGrantStore } from "./db/delegate-grants.ts";
import { createMemoryDerivedDataStore } from "./db/derived-data.ts";
import { createCasFacade } from "./services/cas.ts";
import { createRealmFacadeFromConfig } from "./services/realm.ts";

const config = loadConfig();
const { cas, key } = createCasFacade(config);
const realm = createRealmFacadeFromConfig(cas, key, config);
const delegateGrantStore = createMemoryDelegateGrantStore();
const derivedDataStore = createMemoryDerivedDataStore();
const app = createApp({
  config,
  cas,
  realm,
  delegateGrantStore,
  derivedDataStore,
});
Bun.serve({ port: config.port, fetch: app.fetch });
