/**
 * CASFA v2 - Lambda Handler
 *
 * Uses real implementations for AWS Lambda deployment.
 */

import { createS3Storage } from "@casfa/storage-s3";
import { handle } from "hono/aws-lambda";
import { createApp, createNodeKeyProvider } from "./app.ts";
import { createCognitoJwtVerifier } from "./auth/index.ts";
import { createDbInstances } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";

// ============================================================================
// Create Dependencies (once for Lambda warm start)
// ============================================================================

const config = loadConfig();
const db = createDbInstances(config);

const storage = createS3Storage({
  bucket: config.storage.bucket,
  prefix: config.storage.prefix,
  region: config.storage.region,
});

const keyProvider = createNodeKeyProvider();

// Create Cognito JWT verifier for production
const jwtVerifier = config.cognito.userPoolId
  ? createCognitoJwtVerifier(config.cognito)
  : undefined;

// ============================================================================
// Create App
// ============================================================================

const app = createApp({
  config,
  db,
  storage,
  keyProvider,
  jwtVerifier: jwtVerifier!,
  runtimeInfo: {
    storageType: "s3",
    authType: config.cognito.userPoolId ? "cognito" : "tokens-only",
    databaseType: "aws",
  },
});

// ============================================================================
// Lambda Handler
// ============================================================================

export const handler = handle(app);
