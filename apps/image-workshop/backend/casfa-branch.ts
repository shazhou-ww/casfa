/**
 * Casfa branch client: upload file and complete branch using a single branch root URL.
 * Uses server-next path-based access: {branchRootUrl}/api/realm/me/... (no Bearer token).
 */
export type CasfaBranchOptions = {
  /** Branch root URL (accessUrlPrefix from branch_create), e.g. https://drive.example.com/branch/{branchId}/{verification}. */
  branchRootUrl: string;
};

function getEnv(name: string): string | undefined {
  if (typeof Bun !== "undefined" && Bun.env) return Bun.env[name];
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

export function createCasfaBranchClient(options?: Partial<CasfaBranchOptions>) {
  const branchRootUrl = (options?.branchRootUrl ?? getEnv("CASFA_BRANCH_URL") ?? "").replace(
    /\/$/,
    ""
  );

  function apiUrl(path: string): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${branchRootUrl}${p}`;
  }

  return {
    /**
     * Set branch root to the given file content (single file node as root). Use for branches
     * created with a non-existent mountPath (null root). No token; branch root URL carries auth.
     */
    async setRootToFile(
      data: Uint8Array,
      contentType: string
    ): Promise<{ path: string; key: string }> {
      if (!branchRootUrl) throw new Error("branchRootUrl is required (options or CASFA_BRANCH_URL)");
      const url = apiUrl("/api/realm/me/root");
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(data.length),
        },
        body: new Blob([data as BlobPart]),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = res.statusText;
        try {
          const json = JSON.parse(text) as { message?: string };
          if (typeof json.message === "string") message = json.message;
        } catch {
          message = text || message;
        }
        throw new Error(`Casfa set root failed ${res.status}: ${message}`);
      }
      const json = (await res.json()) as { path: string; key: string };
      return json;
    },

    /**
     * Upload file to the branch. Path = full path including filename (e.g. "output.png").
     * No token; branch root URL carries auth.
     */
    async uploadFile(
      path: string,
      data: Uint8Array,
      contentType: string
    ): Promise<{ path: string; key: string }> {
      if (!branchRootUrl) throw new Error("branchRootUrl is required (options or CASFA_BRANCH_URL)");
      const url = apiUrl(`/api/realm/me/files/${encodeURIComponent(path)}`);
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(data.length),
        },
        body: new Blob([data as BlobPart]),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = res.statusText;
        try {
          const json = JSON.parse(text) as { message?: string };
          if (typeof json.message === "string") message = json.message;
        } catch {
          message = text || message;
        }
        throw new Error(`Casfa upload failed ${res.status}: ${message}`);
      }
      const json = (await res.json()) as { path: string; key: string };
      return json;
    },

    /**
     * Complete the branch (merge back to parent). No token; branch root URL carries auth.
     */
    async completeBranch(): Promise<{ completed: string }> {
      if (!branchRootUrl) throw new Error("branchRootUrl is required (options or CASFA_BRANCH_URL)");
      const url = apiUrl("/api/realm/me/branches/me/complete");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        let message = res.statusText;
        try {
          const json = JSON.parse(text) as { message?: string };
          if (typeof json.message === "string") message = json.message;
        } catch {
          message = text || message;
        }
        throw new Error(`Casfa complete branch failed ${res.status}: ${message}`);
      }
      const json = (await res.json()) as { completed: string };
      return json;
    },
  };
}

export type CasfaBranchClient = ReturnType<typeof createCasfaBranchClient>;
