import { http } from "./http";
import type { FsLsResponse, FsMutationResponse, FsStatResponse } from "./types";

const getAccessToken = () => localStorage.getItem("casfa_access");

const fsHeaders = () => ({
  "X-CAS-Index-Path": ".",
});

const fsUrl = (realm: string, root: string, op: string, params?: Record<string, string>) => {
  const base = `/api/realm/${realm}/nodes/${encodeURIComponent(root)}/fs/${op}`;
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  return `${base}?${qs}`;
};

export const filesystemApi = {
  stat: (realm: string, root: string, path: string) =>
    http.get<FsStatResponse>(fsUrl(realm, root, "stat", { path }), {
      headers: fsHeaders(),
      token: getAccessToken()!,
    }),

  ls: (realm: string, root: string, path: string, cursor?: string) =>
    http.get<FsLsResponse>(fsUrl(realm, root, "ls", { path, ...(cursor ? { cursor } : {}) }), {
      headers: fsHeaders(),
      token: getAccessToken()!,
    }),

  read: (realm: string, root: string, path: string) =>
    http.get<Response>(fsUrl(realm, root, "read", { path }), {
      headers: fsHeaders(),
      token: getAccessToken()!,
    }),

  write: async (realm: string, root: string, path: string, data: Uint8Array, contentType: string) =>
    http.put<FsMutationResponse>(fsUrl(realm, root, "write", { path, contentType }), data, {
      headers: { ...fsHeaders(), "Content-Type": "application/octet-stream" },
      token: getAccessToken()!,
    }),

  mkdir: (realm: string, root: string, path: string) =>
    http.post<FsMutationResponse>(
      fsUrl(realm, root, "mkdir"),
      { path },
      { headers: fsHeaders(), token: getAccessToken()! }
    ),

  rm: (realm: string, root: string, path: string) =>
    http.post<FsMutationResponse>(
      fsUrl(realm, root, "rm"),
      { path },
      { headers: fsHeaders(), token: getAccessToken()! }
    ),

  mv: (realm: string, root: string, from: string, to: string) =>
    http.post<FsMutationResponse>(
      fsUrl(realm, root, "mv"),
      { from, to },
      { headers: fsHeaders(), token: getAccessToken()! }
    ),

  cp: (realm: string, root: string, from: string, to: string) =>
    http.post<FsMutationResponse>(
      fsUrl(realm, root, "cp"),
      { from, to },
      { headers: fsHeaders(), token: getAccessToken()! }
    ),
};
