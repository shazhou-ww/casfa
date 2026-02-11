/**
 * Filesystem API functions for @casfa/client.
 *
 * All filesystem operations are mounted under:
 *   /api/realm/{realmId}/nodes/{nodeKey}/fs/{op}
 *
 * Where nodeKey is the depot's current root node.
 *
 * Token Requirements:
 * - Read ops (stat, ls, read): Access Token
 * - Write ops (write, mkdir, rm, mv, cp, rewrite): Access Token with canUpload
 */

import type {
  FsCpResponse,
  FsLsResponse,
  FsMkdirResponse,
  FsMvResponse,
  FsRewriteEntry,
  FsRewriteResponse,
  FsRmResponse,
  FsStatResponse,
  FsWriteResponse,
} from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

// ============================================================================
// Helpers
// ============================================================================

function buildFsUrl(baseUrl: string, realm: string, rootKey: string, op: string): string {
  return `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/${encodeURIComponent(rootKey)}/fs/${op}`;
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * GET /fs/stat — Get file/directory metadata.
 */
export const fsStat = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  path?: string
): Promise<FetchResult<FsStatResponse>> => {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const qs = params.toString();
  const url = `${buildFsUrl(baseUrl, realm, rootKey, "stat")}${qs ? `?${qs}` : ""}`;

  return fetchWithAuth<FsStatResponse>(url, `Bearer ${accessTokenBase64}`);
};

/**
 * GET /fs/ls — List directory contents with pagination.
 */
export const fsLs = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  path?: string,
  opts?: { limit?: number; cursor?: string }
): Promise<FetchResult<FsLsResponse>> => {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  const url = `${buildFsUrl(baseUrl, realm, rootKey, "ls")}${qs ? `?${qs}` : ""}`;

  return fetchWithAuth<FsLsResponse>(url, `Bearer ${accessTokenBase64}`);
};

/**
 * GET /fs/read — Read file content as Blob.
 */
export const fsRead = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  path: string
): Promise<FetchResult<Blob>> => {
  const params = new URLSearchParams({ path });
  const url = `${buildFsUrl(baseUrl, realm, rootKey, "read")}?${params}`;

  // Custom fetch — need Blob response, fetchWithAuth only does JSON
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessTokenBase64}` },
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (typeof body.message === "string") message = body.message;
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: { code: String(response.status), message, status: response.status },
      };
    }

    const blob = await response.blob();
    return { ok: true, data: blob, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error",
      },
    };
  }
};

// ============================================================================
// Write Operations
// ============================================================================

/**
 * POST /fs/write — Create or overwrite a file.
 * Body is raw binary. Path via query param, content-type via header.
 */
export const fsWrite = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  path: string,
  data: Blob | ArrayBuffer | Uint8Array,
  contentType = "application/octet-stream"
): Promise<FetchResult<FsWriteResponse>> => {
  const params = new URLSearchParams({ path });
  const url = `${buildFsUrl(baseUrl, realm, rootKey, "write")}?${params}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Blob accepts Uint8Array at runtime
  const body: Blob = data instanceof Blob ? data : new Blob([data as any], { type: contentType });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessTokenBase64}`,
        "Content-Type": contentType,
        "Content-Length": String(body.size),
      },
      body,
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (typeof body.message === "string") message = body.message;
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: { code: String(response.status), message, status: response.status },
      };
    }

    const result = (await response.json()) as FsWriteResponse;
    return { ok: true, data: result, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error",
      },
    };
  }
};

/**
 * POST /fs/mkdir — Create a directory.
 */
export const fsMkdir = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  path: string
): Promise<FetchResult<FsMkdirResponse>> => {
  const url = buildFsUrl(baseUrl, realm, rootKey, "mkdir");

  return fetchWithAuth<FsMkdirResponse>(url, `Bearer ${accessTokenBase64}`, {
    method: "POST",
    body: { path },
  });
};

/**
 * POST /fs/rm — Remove a file or directory.
 */
export const fsRm = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  path: string
): Promise<FetchResult<FsRmResponse>> => {
  const url = buildFsUrl(baseUrl, realm, rootKey, "rm");

  return fetchWithAuth<FsRmResponse>(url, `Bearer ${accessTokenBase64}`, {
    method: "POST",
    body: { path },
  });
};

/**
 * POST /fs/mv — Move or rename a file/directory.
 */
export const fsMv = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  from: string,
  to: string
): Promise<FetchResult<FsMvResponse>> => {
  const url = buildFsUrl(baseUrl, realm, rootKey, "mv");

  return fetchWithAuth<FsMvResponse>(url, `Bearer ${accessTokenBase64}`, {
    method: "POST",
    body: { from, to },
  });
};

/**
 * POST /fs/cp — Copy a file or directory.
 */
export const fsCp = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  from: string,
  to: string
): Promise<FetchResult<FsCpResponse>> => {
  const url = buildFsUrl(baseUrl, realm, rootKey, "cp");

  return fetchWithAuth<FsCpResponse>(url, `Bearer ${accessTokenBase64}`, {
    method: "POST",
    body: { from, to },
  });
};

/**
 * POST /fs/rewrite — Batch rewrite directory tree.
 */
export const fsRewrite = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  rootKey: string,
  entries?: Record<string, FsRewriteEntry>,
  deletes?: string[]
): Promise<FetchResult<FsRewriteResponse>> => {
  const url = buildFsUrl(baseUrl, realm, rootKey, "rewrite");

  return fetchWithAuth<FsRewriteResponse>(url, `Bearer ${accessTokenBase64}`, {
    method: "POST",
    body: { entries, deletes },
  });
};
