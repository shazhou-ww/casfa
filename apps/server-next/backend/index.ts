/**
 * Local HTTP server (bun run backend/index.ts). DB = DynamoDB, Blob = S3.
 */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDynamoDelegateGrantStore } from "./db/dynamo-delegate-grant-store.ts";
import { createDynamoBranchStore } from "./db/dynamo-branch-store.ts";
import { createMemoryDerivedDataStore } from "./db/derived-data.ts";
import { createMemoryRealmUsageStore } from "./db/realm-usage-store.ts";
import { createMemoryUserSettingsStore } from "./db/user-settings.ts";
import { createCasFacade } from "./services/cas.ts";

const config = loadConfig();
const { cas, key } = createCasFacade(config);
const branchStore = createDynamoBranchStore({
  tableName: config.dynamodbTableRealms,
  clientConfig: config.dynamodbEndpoint
    ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
    : undefined,
});
const delegateGrantStore = createDynamoDelegateGrantStore({
  tableName: config.dynamodbTableGrants,
  clientConfig: config.dynamodbEndpoint
    ? { endpoint: config.dynamodbEndpoint, region: "us-east-1" }
    : undefined,
});
const derivedDataStore = createMemoryDerivedDataStore();
const realmUsageStore = createMemoryRealmUsageStore();
const userSettingsStore = createMemoryUserSettingsStore();
const app = createApp({
  config,
  cas,
  key,
  branchStore,
  delegateGrantStore,
  derivedDataStore,
  realmUsageStore,
  userSettingsStore,
});
Bun.serve({ port: config.port, fetch: app.fetch });
