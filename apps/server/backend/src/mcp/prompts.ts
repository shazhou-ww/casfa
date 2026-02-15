/**
 * MCP Prompt Definitions
 *
 * Reusable prompt templates that help AI understand CASFA's immutable
 * write model, chained edits, and depot commit workflow.
 *
 * Design: docs/mcp-tools/README.md
 */

// ============================================================================
// Types
// ============================================================================

type McpPromptArgument = {
  name: string;
  description: string;
  required: boolean;
};

type McpPrompt = {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
};

type McpPromptMessage = {
  role: "user";
  content: { type: "text"; text: string };
};

// ============================================================================
// Prompt Definitions
// ============================================================================

export const MCP_PROMPTS: McpPrompt[] = [
  {
    name: "casfa-guide",
    description:
      "Overview of CASFA (Content-Addressable Storage for Agents) — the immutable storage model, key concepts, and how to use MCP tools effectively.",
  },
  {
    name: "edit-files",
    description:
      "Guide for editing files in a CASFA depot — covers reading, writing, chaining multiple edits, and committing.",
    arguments: [
      {
        name: "depotId",
        description: "The depot to edit (dpt_ prefix)",
        required: true,
      },
    ],
  },
  {
    name: "explore-project",
    description: "Strategies for efficiently exploring a CASFA project's file structure.",
    arguments: [
      {
        name: "depotId",
        description: "The depot to explore (dpt_ prefix)",
        required: true,
      },
    ],
  },
  {
    name: "refactor",
    description:
      "Guide for using fs_rewrite to perform declarative directory restructuring — batch moves, renames, and deletions in a single atomic operation.",
    arguments: [
      {
        name: "depotId",
        description: "The depot to refactor (dpt_ prefix)",
        required: true,
      },
    ],
  },
];

// ============================================================================
// Prompt Content Generators
// ============================================================================

const CASFA_GUIDE_CONTENT = `You are working with CASFA, a content-addressable storage (CAS) system. Key concepts:

## Data model
- All data is stored as immutable CAS nodes identified by their content hash (nod_xxx).
- A **dict node** is a directory (ordered list of named children).
- A **file node** holds file content (≤4MB per block).
- Nodes form a Merkle DAG (directed acyclic graph) — changing any file produces a new root hash all the way up.

## Depots
- A **Depot** (dpt_xxx) is a named mutable pointer to a root node, like a Git branch.
- Use \`list_depots\` to discover available depots.
- Use a depot ID (dpt_xxx) as the \`nodeKey\` parameter to start browsing or editing.

## Immutable writes
- **Every write operation returns a \`newRoot\`** — a new root hash reflecting the change.
- The original tree is unchanged (CAS is append-only).
- **Writes do NOT update the depot automatically**. You must call \`depot_commit\` to persist.

## Chained edits
When making multiple changes:
1. First write: use \`dpt_xxx\` as nodeKey → get \`newRoot\` A
2. Second write: use \`newRoot\` A as nodeKey → get \`newRoot\` B
3. Continue chaining...
4. Final step: \`depot_commit(depotId, lastNewRoot)\` — one commit for all changes.

## Read operations
- \`fs_ls\` — list directory contents
- \`fs_read\` — read text file content (do NOT use on binary files)
- \`fs_stat\` — get file/dir metadata without reading content
- Use \`fs_stat\` to check \`contentType\` before reading unknown files.

## Important constraints
- File read/write limited to ≤4MB (single-block files only).
- All paths are relative, no \`.\` or absolute paths allowed.
- \`~N\` segments in paths (e.g., \`~0/~1\`) navigate by child index.`;

function editFilesContent(depotId: string): string {
  return `You are editing files in depot \`${depotId}\`. Follow this workflow:

## Reading files
\`\`\`
fs_read(nodeKey: "${depotId}", path: "path/to/file.ts")
\`\`\`

## Writing a single file
\`\`\`
1. fs_write(nodeKey: "${depotId}", path: "file.ts", content: "...")
   → { newRoot: "nod_A..." }
2. depot_commit(depotId: "${depotId}", root: "nod_A...")
\`\`\`

## Writing multiple files (IMPORTANT: chain the newRoot!)
\`\`\`
1. fs_write(nodeKey: "${depotId}", path: "a.ts", content: "...")
   → { newRoot: "nod_step1..." }
2. fs_write(nodeKey: "nod_step1...", path: "b.ts", content: "...")  ← use previous newRoot!
   → { newRoot: "nod_step2..." }
3. depot_commit(depotId: "${depotId}", root: "nod_step2...")  ← commit final root only
\`\`\`

## Common mistakes to avoid
- ❌ Using \`${depotId}\` as nodeKey for every write — this discards intermediate changes!
- ❌ Forgetting to call \`depot_commit\` — changes exist but depot still points to old root.
- ❌ Calling \`depot_commit\` after each write — creates unnecessary history entries. Chain first, commit once.
- ❌ Reading binary files with \`fs_read\` — check contentType with \`fs_stat\` first.`;
}

function exploreProjectContent(depotId: string): string {
  return `You are exploring the project in depot \`${depotId}\`. Efficient strategies:

## Start with the root
\`\`\`
fs_ls(nodeKey: "${depotId}")
\`\`\`
This shows all top-level files and directories.

## Drill into directories
\`\`\`
fs_ls(nodeKey: "${depotId}", path: "src")
fs_ls(nodeKey: "${depotId}", path: "src/commands")
\`\`\`

## Check before reading
Use \`fs_stat\` to check file size and type before reading:
\`\`\`
fs_stat(nodeKey: "${depotId}", path: "data/large.bin")
→ { type: "file", size: 5242880, contentType: "application/octet-stream" }
\`\`\`
- If \`size\` > 4MB → cannot use \`fs_read\` (file too large)
- If \`contentType\` is binary (image/*, application/octet-stream, etc.) → skip \`fs_read\`

## Reading files
\`\`\`
fs_read(nodeKey: "${depotId}", path: "README.md")
\`\`\`

## Tips
- Read \`README.md\` or \`package.json\` first for project overview.
- Look for \`src/\`, \`lib/\`, \`app/\` directories for main source code.
- Use the \`index\` field from \`fs_ls\` results for \`~N\` navigation if needed.`;
}

function refactorContent(depotId: string): string {
  return `You are refactoring the project in depot \`${depotId}\` using \`fs_rewrite\`.

## What is fs_rewrite?
A declarative tool that describes the desired final tree state — the server computes the diff atomically.
No intermediate roots, no ordering issues. All-or-nothing.

## Entry types
- \`{ "from": "old/path" }\` — reference a file or directory from the original tree
- \`{ "dir": true }\` — create an empty directory
- \`{ "link": "nod_xxx" }\` — mount an existing CAS node (must be owned)

## Common patterns

### Rename / Move
\`\`\`json
{
  "entries": { "new/path.ts": { "from": "old/path.ts" } },
  "deletes": ["old/path.ts"]
}
\`\`\`
(from + delete = move)

### Copy
\`\`\`json
{
  "entries": { "copy.ts": { "from": "original.ts" } }
}
\`\`\`
(from without delete = copy)

### Batch restructure
\`\`\`json
{
  "entries": {
    "lib/core/index.ts": { "from": "src/core.ts" },
    "lib/core/utils.ts": { "from": "src/utils/core-utils.ts" },
    "lib/plugins": { "from": "src/plugins" }
  },
  "deletes": ["src/core.ts", "src/utils/core-utils.ts", "src/old-plugins"]
}
\`\`\`

## Combining with fs_write
To create new files AND restructure:
1. \`fs_write\` the new files first → get \`newRoot\`
2. \`fs_rewrite\` on the \`newRoot\` to restructure → get final \`newRoot\`
3. \`depot_commit\` once with the final root

## Limits
- Max 100 total entries + deletes per rewrite.
- \`from\` references are based on the ORIGINAL tree (not intermediate state).
- All \`from\` paths must exist; missing paths cause the entire operation to fail.`;
}

// ============================================================================
// Get Prompt Messages
// ============================================================================

export function getPromptMessages(
  name: string,
  args?: Record<string, string>
): McpPromptMessage[] | null {
  switch (name) {
    case "casfa-guide":
      return [{ role: "user", content: { type: "text", text: CASFA_GUIDE_CONTENT } }];

    case "edit-files": {
      const depotId = args?.depotId;
      if (!depotId) return null;
      return [{ role: "user", content: { type: "text", text: editFilesContent(depotId) } }];
    }

    case "explore-project": {
      const depotId = args?.depotId;
      if (!depotId) return null;
      return [{ role: "user", content: { type: "text", text: exploreProjectContent(depotId) } }];
    }

    case "refactor": {
      const depotId = args?.depotId;
      if (!depotId) return null;
      return [{ role: "user", content: { type: "text", text: refactorContent(depotId) } }];
    }

    default:
      return null;
  }
}
