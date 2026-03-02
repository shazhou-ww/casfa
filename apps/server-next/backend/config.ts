export type ServerConfig = {
  port: number;
  storage: {
    type: "memory" | "fs";
    fsPath?: string;
  };
  auth: {
    mockJwtSecret?: string;
    maxBranchTtlMs?: number;
    cognitoRegion?: string;
    cognitoUserPoolId?: string;
    cognitoClientId?: string;
  };
};

const DEFAULT_PORT = 8802;

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const storageType = process.env.STORAGE_TYPE === "fs" ? "fs" : "memory";
  const storage: ServerConfig["storage"] =
    storageType === "fs"
      ? { type: "fs", fsPath: process.env.STORAGE_FS_PATH }
      : { type: "memory" };
  const auth: ServerConfig["auth"] = {
    mockJwtSecret: process.env.MOCK_JWT_SECRET,
    maxBranchTtlMs: process.env.MAX_BRANCH_TTL_MS
      ? Number(process.env.MAX_BRANCH_TTL_MS)
      : undefined,
    cognitoRegion: process.env.COGNITO_REGION,
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cognitoClientId: process.env.COGNITO_CLIENT_ID,
  };
  return { port, storage, auth };
}
