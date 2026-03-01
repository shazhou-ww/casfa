/**
 * MCP Tool Definitions
 *
 * 16 tools covering depot management, filesystem operations, node metadata,
 * delegate creation, and realm info.
 *
 * Design: docs/mcp-tools/README.md
 */

// ============================================================================
// Tool Annotation Types
// ============================================================================

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations?: ToolAnnotations;
};

// ============================================================================
// Tool Definitions
// ============================================================================

export const MCP_TOOLS: McpTool[] = [
  // ── Read: Depots ─────────────────────────────────────────────────────
  {
    name: "list_depots",
    description:
      "List all depots in the user's realm. A depot is a named mutable pointer to a CAS root node, like a Git branch. Returns depot IDs, titles, current root keys, and timestamps. This is typically the first tool to call when exploring a user's data.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max depots per page (default 100)" },
        cursor: { type: "string", description: "Pagination cursor from a previous response" },
      },
      required: [],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_depot",
    description:
      "Get details of a specific depot, including its current root node key and commit history. Use the depot's root key as a starting point for file system operations.",
    inputSchema: {
      type: "object",
      properties: {
        depotId: { type: "string", description: "Depot ID (dpt_ prefix)" },
      },
      required: ["depotId"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },

  // ── Read: Filesystem ─────────────────────────────────────────────────
  {
    name: "fs_stat",
    description:
      "Get metadata about a file or directory at a given path. Returns type (file/dir), name, CAS key, size (for files), or child count (for directories). The nodeKey can be a depot ID (dpt_xxx, resolves to current root) or a node key (nod_xxx, immutable hash).",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description:
            "Relative path within the tree (e.g., 'src/main.ts'). Omit for root node itself. Supports ~N index segments (e.g., '~0/~1').",
        },
      },
      required: ["nodeKey"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "fs_ls",
    description:
      "List the direct children of a directory. Returns each child's name, type (file/dir), CAS key, index, and size or child count. Supports pagination via cursor. Use this to browse project structure.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description:
            "Directory path within the tree (e.g., 'src/commands'). Omit for root directory.",
        },
        limit: {
          type: "number",
          description: "Max children per page (default 100, max 1000)",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from a previous response",
        },
      },
      required: ["nodeKey"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "fs_read",
    description:
      "Read the contents of a text file. Only works for single-block files (≤4MB). Returns the file content as UTF-8 text along with metadata (key, size, contentType). Do NOT use this for binary files (images, compiled code, etc.) — check contentType via fs_stat first if unsure.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description:
            "File path within the tree (e.g., 'src/main.ts'). Supports ~N index segments.",
        },
      },
      required: ["nodeKey"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },

  {
    name: "fs_tree",
    description:
      "Get a recursive directory tree with BFS traversal and budget-based truncation. Returns a nested JSON structure showing the full hierarchy: directories with child count, files with MIME type and size. Directories beyond the depth limit or entry budget are marked 'collapsed: true'. Much more efficient than recursive fs_ls — use this as the first step when exploring a depot's structure.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description: "Subdirectory path to start from (e.g., 'src/components'). Omit for root.",
        },
        depth: {
          type: "number",
          description:
            "Max recursion depth (default 3, -1 for unlimited). Directories beyond this depth are collapsed.",
        },
        maxEntries: {
          type: "number",
          description:
            "Max total entries in the result (default 500, max 5000). When budget is exhausted, remaining directories are collapsed.",
        },
      },
      required: ["nodeKey"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },

  // ── Read: Node Metadata ──────────────────────────────────────────────
  {
    name: "node_metadata",
    description:
      "Get structural metadata of a CAS node. For dict nodes, returns the children map (name → key). For file nodes, returns size and content type. Lower-level than fs_ls/fs_stat — use this when you need the raw children map or to inspect successor chains.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Node key (nod_xxx) or depot ID (dpt_xxx)",
        },
        navigation: {
          type: "string",
          description:
            "Optional ~N navigation path from nodeKey (e.g., '~0/~1/~2'). Each segment selects a child by index.",
        },
      },
      required: ["nodeKey"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },

  // ── Write: Filesystem ────────────────────────────────────────────────
  {
    name: "fs_write",
    description:
      "Create or overwrite a text file (≤4MB). Returns a new root node key (CAS is immutable — writes produce a new tree root). The depot is NOT automatically updated; call depot_commit with the returned newRoot to persist the change. For chained edits, use the returned newRoot as the nodeKey for the next operation.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description:
            "File path (e.g., 'src/main.ts'). Intermediate directories are created automatically.",
        },
        content: { type: "string", description: "The text content to write (UTF-8)" },
        contentType: {
          type: "string",
          description:
            "MIME type (default: auto-detected from file extension, fallback 'text/plain')",
        },
      },
      required: ["nodeKey", "path", "content"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "fs_mkdir",
    description:
      "Create a directory (like mkdir -p). Intermediate directories are created automatically. Idempotent: if the directory already exists, returns the current root without changes.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description: "Directory path to create (e.g., 'src/utils/parsers')",
        },
      },
      required: ["nodeKey", "path"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "fs_rm",
    description:
      "Delete a file or directory. Deleting a directory removes all its children recursively (but CAS nodes are not physically deleted since they may be referenced elsewhere). Returns the new root.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        path: {
          type: "string",
          description:
            "Path of the file or directory to delete (e.g., 'src/old-module.ts'). Supports ~N index segments.",
        },
      },
      required: ["nodeKey", "path"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "fs_mv",
    description:
      "Move or rename a file or directory. If the target's parent directory doesn't exist, it is created automatically. Returns the new root.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        from: { type: "string", description: "Source path (e.g., 'src/old-name.ts')" },
        to: {
          type: "string",
          description: "Destination path (e.g., 'src/utils/new-name.ts')",
        },
      },
      required: ["nodeKey", "from", "to"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "fs_cp",
    description:
      "Copy a file or directory to a new path. In CAS, copying a directory only creates new references (no data duplication). Returns the new root.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        from: { type: "string", description: "Source path (e.g., 'src/template.ts')" },
        to: {
          type: "string",
          description: "Destination path (e.g., 'src/utils/template-copy.ts')",
        },
      },
      required: ["nodeKey", "from", "to"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "fs_rewrite",
    description:
      "Declaratively restructure a directory tree in a single operation. Describe the desired final state through path mappings (from/dir/link) and deletions — the server computes the new tree atomically. No intermediate roots are produced. Use this for batch moves, renames, directory restructuring, or mounting existing nodes. Max 100 total entries + deletes.",
    inputSchema: {
      type: "object",
      properties: {
        nodeKey: {
          type: "string",
          description: "Root node identifier: depot ID (dpt_xxx) or node key (nod_xxx)",
        },
        entries: {
          type: "object",
          description:
            'Path mappings. Keys are target paths in the new tree. Values are objects with ONE of: {"from": "old/path"} to reference a node from the original tree, {"dir": true} to create an empty directory, or {"link": "nod_xxx"} to mount an existing CAS node.',
          additionalProperties: {
            type: "object",
            properties: {
              from: { type: "string", description: "Source path in the original tree" },
              dir: { type: "boolean", description: "Create empty directory (must be true)" },
              link: {
                type: "string",
                description: "CAS node key to mount (nod_xxx, must be owned)",
              },
            },
          },
        },
        deletes: {
          type: "array",
          items: { type: "string" },
          description: "Paths to delete from the tree",
        },
      },
      required: ["nodeKey"],
    },
    annotations: { destructiveHint: true },
  },

  // ── Write: Depot Commit ──────────────────────────────────────────────
  {
    name: "depot_commit",
    description:
      "Commit a new root node to a depot. File system write operations (fs_write, fs_rm, fs_mv, etc.) produce a new root but do NOT update the depot automatically. Call this to persist the new root. The old root is moved to history.",
    inputSchema: {
      type: "object",
      properties: {
        depotId: { type: "string", description: "Depot ID (dpt_ prefix)" },
        root: {
          type: "string",
          description: "New root node key (nod_ prefix) from a previous write operation",
        },
        expectedRoot: {
          type: ["string", "null"],
          description:
            "Optimistic lock: expected current depot root. If server root differs, the commit fails with a conflict error. Omit to skip the check (backward-compatible). Use null to assert the depot has no root yet.",
        },
      },
      required: ["depotId", "root"],
    },
    annotations: { destructiveHint: true },
  },

  // ── Write: Delegate ──────────────────────────────────────────────────
  {
    name: "create_delegate",
    description:
      "Create a child delegate with restricted permissions. The child inherits the caller's realm and cannot exceed the caller's permissions (canUpload, canManageDepot, expiration, scope). Returns a new access token and refresh token for the child delegate. Use this to grant limited access to other AI agents or tools — e.g., read-only access to a specific subtree.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the delegate (e.g., 'code-review-agent', 'doc-writer')",
        },
        canUpload: {
          type: "boolean",
          description:
            "Allow write operations (upload nodes, fs_write, etc.). Default: false. Cannot exceed parent's permission.",
        },
        scope: {
          type: "array",
          items: { type: "string" },
          description:
            "Scope paths restricting accessible nodes. '.' inherits all parent scope roots. '0:1:2' navigates parent scope root index 0 → child index 1 → child index 2 to create a narrower scope. Uses colon-separated indices. Omit to inherit parent's full scope.",
        },
        expiresIn: {
          type: "number",
          description:
            "Lifetime in seconds. Cannot exceed parent's remaining lifetime. Omit for no expiry (bounded by parent).",
        },
      },
      required: [],
    },
  },

  // ── Read: Realm ──────────────────────────────────────────────────────
  {
    name: "get_realm_info",
    description:
      "Get the current realm's configuration and limits, including whether the token has upload (write) permission.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_usage",
    description:
      "Get storage usage statistics for the current realm, including physical/logical bytes, node count, and quota.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];
