/**
 * Filesystem methods for the stateful client.
 *
 * Provides high-level fs operations that automatically handle
 * token management and root node resolution via depot.
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
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type FsMethods = {
  /** Get file/directory metadata */
  stat: (rootKey: string, path?: string) => Promise<FetchResult<FsStatResponse>>;
  /** List directory contents with pagination */
  ls: (
    rootKey: string,
    path?: string,
    opts?: { limit?: number; cursor?: string }
  ) => Promise<FetchResult<FsLsResponse>>;
  /** Read file content as Blob */
  read: (rootKey: string, path: string) => Promise<FetchResult<Blob>>;
  /** Write (create/overwrite) a file */
  write: (
    rootKey: string,
    path: string,
    data: Blob | ArrayBuffer | Uint8Array,
    contentType?: string
  ) => Promise<FetchResult<FsWriteResponse>>;
  /** Create a directory */
  mkdir: (rootKey: string, path: string) => Promise<FetchResult<FsMkdirResponse>>;
  /** Remove a file or directory */
  rm: (rootKey: string, path: string) => Promise<FetchResult<FsRmResponse>>;
  /** Move or rename */
  mv: (rootKey: string, from: string, to: string) => Promise<FetchResult<FsMvResponse>>;
  /** Copy */
  cp: (rootKey: string, from: string, to: string) => Promise<FetchResult<FsCpResponse>>;
  /** Batch rewrite directory tree */
  rewrite: (
    rootKey: string,
    entries?: Record<string, FsRewriteEntry>,
    deletes?: string[]
  ) => Promise<FetchResult<FsRewriteResponse>>;
};

export type FsDeps = {
  baseUrl: string;
  realm: string;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createFsMethods = ({ baseUrl, realm, tokenSelector }: FsDeps): FsMethods => {
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());

  return {
    stat: (rootKey, path?) =>
      requireAccess((t) => api.fsStat(baseUrl, realm, t.tokenBase64, rootKey, path)),

    ls: (rootKey, path?, opts?) =>
      requireAccess((t) => api.fsLs(baseUrl, realm, t.tokenBase64, rootKey, path, opts)),

    read: (rootKey, path) =>
      requireAccess((t) => api.fsRead(baseUrl, realm, t.tokenBase64, rootKey, path)),

    write: (rootKey, path, data, contentType?) =>
      requireAccess((t) =>
        api.fsWrite(baseUrl, realm, t.tokenBase64, rootKey, path, data, contentType)
      ),

    mkdir: (rootKey, path) =>
      requireAccess((t) => api.fsMkdir(baseUrl, realm, t.tokenBase64, rootKey, path)),

    rm: (rootKey, path) =>
      requireAccess((t) => api.fsRm(baseUrl, realm, t.tokenBase64, rootKey, path)),

    mv: (rootKey, from, to) =>
      requireAccess((t) => api.fsMv(baseUrl, realm, t.tokenBase64, rootKey, from, to)),

    cp: (rootKey, from, to) =>
      requireAccess((t) => api.fsCp(baseUrl, realm, t.tokenBase64, rootKey, from, to)),

    rewrite: (rootKey, entries?, deletes?) =>
      requireAccess((t) => api.fsRewrite(baseUrl, realm, t.tokenBase64, rootKey, entries, deletes)),
  };
};
