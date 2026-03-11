/**
 * Casfa branch client: upload file with branch token, then complete branch.
 * Uses server-next REST: PUT /api/realm/me/files/:path, POST /api/realm/me/branches/me/complete.
 */
export type CasfaBranchOptions = {
  /** Casfa server base URL (e.g. https://api.casfa.example.com or http://localhost:7100). */
  baseUrl: string;
};

function getEnv(name: string): string | undefined {
  if (typeof Bun !== "undefined" && Bun.env) return Bun.env[name];
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

export function createCasfaBranchClient(options?: Partial<CasfaBranchOptions>) {
  const baseUrl = (options?.baseUrl ?? getEnv("CASFA_BASE_URL") ?? "").replace(/\/$/, "");

  return {
    /**
     * Set branch root to the given file content (single file node as root). Use for branches
     * created with a non-existent mountPath (null root). Uses Bearer branchAccessToken.
     */
    async setRootToFile(
      branchAccessToken: string,
      data: Uint8Array,
      contentType: string
    ): Promise<{ path: string; key: string }> {
      if (!baseUrl) throw new Error("CASFA_BASE_URL is required (env or options.baseUrl)");
      const url = `${baseUrl}/api/realm/me/root`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${branchAccessToken}`,
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
     * Upload file to the branch. Path = full path including filename (e.g. "output.png" or "images/out.png").
     * Uses Bearer branchAccessToken.
     */
    async uploadFile(
      branchAccessToken: string,
      path: string,
      data: Uint8Array,
      contentType: string
    ): Promise<{ path: string; key: string }> {
      if (!baseUrl) throw new Error("CASFA_BASE_URL is required (env or options.baseUrl)");
      const url = `${baseUrl}/api/realm/me/files/${encodeURIComponent(path)}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${branchAccessToken}`,
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
     * Complete the branch (merge back to parent). Uses Bearer branchAccessToken.
     */
    async completeBranch(branchAccessToken: string): Promise<{ completed: string }> {
      if (!baseUrl) throw new Error("CASFA_BASE_URL is required (env or options.baseUrl)");
      const url = `${baseUrl}/api/realm/me/branches/me/complete`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${branchAccessToken}`,
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
