import * as fs from "node:fs";
import * as path from "node:path";
import { ensureCasfaDir, getCasfaDir } from "./config";

export interface TokenCredentials {
  type: "token";
  token: string;
}

export interface OAuthCredentials {
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type Credentials = TokenCredentials | OAuthCredentials;

export interface CredentialsStore {
  [profileName: string]: Credentials;
}

export function getCredentialsPath(): string {
  return path.join(getCasfaDir(), "credentials.json");
}

export function loadCredentials(): CredentialsStore {
  const credPath = getCredentialsPath();
  if (!fs.existsSync(credPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(credPath, "utf-8");
    return JSON.parse(content) as CredentialsStore;
  } catch {
    return {};
  }
}

export function saveCredentials(store: CredentialsStore): void {
  ensureCasfaDir();
  const credPath = getCredentialsPath();
  fs.writeFileSync(credPath, JSON.stringify(store, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function getCredentials(profileName: string): Credentials | undefined {
  const store = loadCredentials();
  return store[profileName];
}

export function setCredentials(profileName: string, credentials: Credentials): void {
  const store = loadCredentials();
  store[profileName] = credentials;
  saveCredentials(store);
}

export function deleteCredentials(profileName: string): void {
  const store = loadCredentials();
  delete store[profileName];
  saveCredentials(store);
}

export function isTokenExpired(credentials: Credentials): boolean {
  if (credentials.type === "token") {
    return false; // Agent tokens don't expire on client side
  }
  // Add 60 second buffer
  return Date.now() >= (credentials.expiresAt - 60) * 1000;
}

export function formatExpiresIn(credentials: Credentials): string {
  if (credentials.type === "token") {
    return "N/A (agent token)";
  }
  const now = Date.now();
  const expiresAt = credentials.expiresAt * 1000;
  if (now >= expiresAt) {
    return "Expired";
  }
  const diff = expiresAt - now;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
