/**
 * AWS Lambda entry: same app as index.ts, exported as handler for API Gateway HTTP API.
 * Used by Serverless Framework and serverless-offline.
 */
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMemoryDelegateGrantStore } from "./db/delegate-grants.ts";
import { createMemoryDerivedDataStore } from "./db/derived-data.ts";
import { createMemoryUserSettingsStore } from "./db/user-settings.ts";
import { createCasFacade } from "./services/cas.ts";
import { createRealmFacadeFromConfig } from "./services/realm.ts";
import { createMemoryDelegateStore } from "@casfa/realm";

const config = loadConfig();
const { cas, key } = createCasFacade(config);
const delegateStore = createMemoryDelegateStore();
const realm = createRealmFacadeFromConfig(cas, key, config, delegateStore);
const delegateGrantStore = createMemoryDelegateGrantStore();
const derivedDataStore = createMemoryDerivedDataStore();
const userSettingsStore = createMemoryUserSettingsStore();

const app = createApp({
  config,
  cas,
  key,
  realm,
  delegateGrantStore,
  derivedDataStore,
  delegateStore,
  userSettingsStore,
});

export const handler = handle(app);
