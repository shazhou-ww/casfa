/**
 * Filesystem API helpers for the Web UI.
 *
 * The @casfa/client package does not include filesystem API wrappers yet,
 * so we call the server endpoints directly using the Access Token
 * obtained from the client's TokenSelector.
 *
 * All filesystem operations are mounted under:
 *   /api/realm/{realmId}/nodes/{nodeKey}/fs/...
 *
 * Where nodeKey is the depot's current root node.
 */

import type {
  FsCpResponse,
  FsLsResponse,
  FsMkdirResponse,
  FsMvResponse,
  FsRmResponse,
  FsStatResponse,
  FsWriteResponse,
} from "@casfa/protocol";
import { getClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type FsResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the access token base64 from the client.
 * The client's TokenSelector auto-issues access tokens as needed.
 */
async function getAccessToken(): Promise<string | null> {
  const client = await getClient();
  const state = client.getState();
  if (state.access?.tokenBase64) return state.access.tokenBase64;

  // Trigger auto-issuance by calling a depot method (which calls ensureAccessToken)
  // We do a lightweight call to trigger the token selector
  const result = await client.depots.list({ limit: 1 });
  if (!result.ok) return null;

  const newState = client.getState();
  return newState.access?.tokenBase64 ?? null;
}

/**
 * Get realm from the current user state.
 */
async function getRealm(): Promise<string> {
  const client = await getClient();
  const state = client.getState();
  return state.user?.userId ?? "";
}

/**
 * Build the base URL for filesystem operations on a given root node.
 */
function buildFsUrl(realm: string, rootKey: string, op: string): string {
  return `/api/realm/${encodeURIComponent(realm)}/nodes/${encodeURIComponent(rootKey)}/fs/${op}`;
}

async function fetchJson<T>(url: string, token: string, init?: RequestInit): Promise<FsResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return {
        ok: false,
        error: (body as { message?: string }).message ?? `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ============================================================================
// Filesystem Operations
// ============================================================================

/**
 * GET /fs/stat — Get file/directory metadata
 */
export async function fsStat(rootKey: string, path: string): Promise<FsResult<FsStatResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const url = `${buildFsUrl(realm, rootKey, "stat")}?${params}`;

  return fetchJson<FsStatResponse>(url, token);
}

/**
 * GET /fs/ls — List directory contents
 */
export async function fsLs(
  rootKey: string,
  path: string,
  limit = 200,
  cursor?: string
): Promise<FsResult<FsLsResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const params = new URLSearchParams();
  if (path) params.set("path", path);
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const url = `${buildFsUrl(realm, rootKey, "ls")}?${params}`;

  return fetchJson<FsLsResponse>(url, token);
}

/**
 * GET /fs/read — Read file content (returns binary)
 */
export async function fsRead(rootKey: string, path: string): Promise<FsResult<Blob>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const url = `${buildFsUrl(realm, rootKey, "read")}?${params}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return {
        ok: false,
        error: (body as { message?: string }).message ?? `HTTP ${response.status}`,
      };
    }

    const blob = await response.blob();
    return { ok: true, data: blob };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * POST /fs/write — Create or overwrite a file.
 * Body is raw binary. Path & content-type via query/headers.
 */
export async function fsWrite(
  rootKey: string,
  path: string,
  content: ArrayBuffer | Uint8Array,
  contentType = "application/octet-stream"
): Promise<FsResult<FsWriteResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const params = new URLSearchParams({ path });
  const url = `${buildFsUrl(realm, rootKey, "write")}?${params}`;

  // Convert to ArrayBuffer for Blob constructor compatibility
  const buffer: ArrayBuffer =
    content instanceof Uint8Array
      ? (new Uint8Array(content).buffer as ArrayBuffer)
      : (content as ArrayBuffer);
  const blob = new Blob([buffer], { type: contentType });

  return fetchJson<FsWriteResponse>(url, token, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
    },
    body: blob,
  });
}

/**
 * POST /fs/mkdir — Create a directory
 */
export async function fsMkdir(rootKey: string, path: string): Promise<FsResult<FsMkdirResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const url = buildFsUrl(realm, rootKey, "mkdir");

  return fetchJson<FsMkdirResponse>(url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/**
 * POST /fs/rm — Remove a file or directory
 */
export async function fsRm(rootKey: string, path: string): Promise<FsResult<FsRmResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const url = buildFsUrl(realm, rootKey, "rm");

  return fetchJson<FsRmResponse>(url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/**
 * POST /fs/mv — Move/rename a file or directory
 */
export async function fsMv(
  rootKey: string,
  from: string,
  to: string
): Promise<FsResult<FsMvResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const url = buildFsUrl(realm, rootKey, "mv");

  return fetchJson<FsMvResponse>(url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
}

/**
 * POST /fs/cp — Copy a file or directory
 */
export async function fsCp(
  rootKey: string,
  from: string,
  to: string
): Promise<FsResult<FsCpResponse>> {
  const [token, realm] = await Promise.all([getAccessToken(), getRealm()]);
  if (!token) return { ok: false, error: "No access token" };

  const url = buildFsUrl(realm, rootKey, "cp");

  return fetchJson<FsCpResponse>(url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
}

/**
 * Commit new root to a depot after a filesystem mutation.
 * Every fs mutation returns a newRoot — we must commit it to persist.
 */
export async function commitDepot(
  depotId: string,
  newRoot: string
): Promise<FsResult<{ depotId: string; root: string; updatedAt: number }>> {
  try {
    const client = await getClient();
    const result = await client.depots.commit(depotId, { root: newRoot });
    if (result.ok) {
      return { ok: true, data: result.data };
    }
    return { ok: false, error: result.error.message };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
