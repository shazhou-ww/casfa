/**
 * Casfa branch client: upload file and complete branch using a single branch root URL.
 * Uses drive branch-scoped path access rooted at {branchRootUrl}.
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

  function encodePathSegments(path: string): string {
    return path
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
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
     * Build branch-scoped readable file URL for image input.
     */
    getFileReadUrl(path: string): string {
      if (!branchRootUrl) throw new Error("branchRootUrl is required (options or CASFA_BRANCH_URL)");
      return apiUrl(`/files/${encodePathSegments(path)}`);
    },

    /**
     * Try to request a short-lived restricted file URL from drive.
     * If drive has not enabled this endpoint, callers should fallback to getFileReadUrl().
     */
    async getRestrictedFileUrl(path: string): Promise<string> {
      if (!branchRootUrl) throw new Error("branchRootUrl is required (options or CASFA_BRANCH_URL)");
      const res = await fetch(apiUrl("/branches/me/restricted-file-access"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        throw new Error(`Casfa restricted file access failed ${res.status}`);
      }
      const payload = (await res.json()) as {
        restrictedUrl?: string;
        url?: string;
      };
      const candidate = payload.restrictedUrl ?? payload.url;
      if (!candidate) {
        throw new Error("Casfa restricted file access missing restrictedUrl");
      }
      return candidate;
    },

  };
}

export type CasfaBranchClient = ReturnType<typeof createCasfaBranchClient>;
