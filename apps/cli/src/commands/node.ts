import * as fs from "node:fs";
import * as path from "node:path";
import { api } from "@casfa/client";
import { decodeNode, encodeFileNode } from "@casfa/core";
import { hashToNodeKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3.js";
import type { Command } from "commander";
import { getCachedNode, hasCachedNode, setCachedNode } from "../lib/cache";
import { createClient, requireAuth, requireRealm } from "../lib/client";
import { createFormatter, formatSize } from "../lib/output";

/**
 * Ensure we have an access token for node operations.
 * Returns the access token base64 string.
 */
async function ensureAccessToken(
  resolved: Awaited<ReturnType<typeof createClient>>,
  canUpload: boolean
): Promise<string> {
  const state = resolved.client.getState();

  // If we already have an access token, use it
  if (state.access) {
    return state.access.tokenBase64;
  }

  // Issue a temporary access token
  if (state.delegate) {
    const result = await api.delegateToken(
      resolved.baseUrl,
      state.delegate.tokenBase64,
      {
        name: "cli-node-operation",
        type: "access",
        expiresIn: 3600, // 1 hour
        canUpload,
        canManageDepot: false,
        scope: ["."], // Inherit parent scope
      }
    );

    if (!result.ok) {
      throw new Error(`Failed to get access token: ${result.error.message}`);
    }

    return result.data.tokenBase64;
  }

  if (state.user) {
    const result = await api.createToken(resolved.baseUrl, state.user.accessToken, {
      realm: resolved.realm,
      name: "cli-node-operation",
      type: "access",
      expiresIn: 3600,
      canUpload,
      canManageDepot: false,
    });

    if (!result.ok) {
      throw new Error(`Failed to get access token: ${result.error.message}`);
    }

    return result.data.tokenBase64;
  }

  throw new Error("Authentication required. Run 'casfa auth login' or provide --delegate-token.");
}

export function registerNodeCommands(program: Command): void {
  const node = program.command("node").description("Node operations (content-addressable storage)");

  node
    .command("get <key>")
    .description("Download a file from a node key")
    .option("-o, --output <path>", "output file path")
    .option("--raw", "save raw node bytes without decoding")
    .requiredOption("-i, --index-path <path>", "CAS index path for scope verification (e.g., depot:MAIN:0:1)")
    .action(async (key: string, cmdOpts: { output?: string; raw?: boolean; indexPath: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved, false);

        // Helper to fetch node bytes (with caching)
        const getNodeBytes = async (nodeKey: string): Promise<Uint8Array> => {
          // Check cache first
          if (opts.cache !== false && hasCachedNode(nodeKey)) {
            const cached = getCachedNode(nodeKey);
            if (cached) return new Uint8Array(cached);
          }

          const result = await api.getNode(
            resolved.baseUrl,
            resolved.realm,
            accessToken,
            nodeKey,
            cmdOpts.indexPath
          );
          if (!result.ok) {
            throw new Error(`Failed to get node ${nodeKey}: ${result.error.message}`);
          }

          // Cache the raw node
          if (opts.cache !== false) {
            setCachedNode(nodeKey, Buffer.from(result.data));
          }

          return result.data;
        };

        const rootBytes = await getNodeBytes(key);

        // If --raw, save the raw node bytes
        if (cmdOpts.raw) {
          const outputPath = cmdOpts.output || getDefaultFilename(key);
          fs.writeFileSync(outputPath, Buffer.from(rootBytes));
          formatter.success(`Downloaded raw node ${formatSize(rootBytes.length)} to ${outputPath}`);
          return;
        }

        // Decode the CAS node to extract file content
        const casNode = decodeNode(rootBytes);

        if (casNode.kind === "dict") {
          formatter.error("Cannot download a directory node as file. Use --raw to get raw bytes.");
          process.exit(1);
        }

        if (!casNode.data) {
          formatter.error("Node has no data content.");
          process.exit(1);
        }

        const outputPath = cmdOpts.output || getDefaultFilename(key);
        fs.writeFileSync(outputPath, Buffer.from(casNode.data));
        formatter.success(`Downloaded ${formatSize(casNode.data.length)} to ${outputPath}`);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  node
    .command("put <file>")
    .description("Upload a file and return its node key (use '-' for stdin)")
    .option("-t, --type <mime>", "content type")
    .option("-n, --name <name>", "file name (required for stdin)")
    .action(async (file: string, cmdOpts: { type?: string; name?: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        let data: Buffer;
        let filename: string;
        let contentType = cmdOpts.type;

        if (file === "-") {
          // Read from stdin
          if (!cmdOpts.name) {
            formatter.error("--name is required when reading from stdin");
            process.exit(1);
          }
          data = await readStdin();
          filename = cmdOpts.name;
        } else {
          // Read from file
          if (!fs.existsSync(file)) {
            formatter.error(`File not found: ${file}`);
            process.exit(1);
          }
          data = fs.readFileSync(file);
          filename = cmdOpts.name || path.basename(file);
          contentType = contentType || guessContentType(filename);
        }

        const resolved = await createClient(opts);
        requireRealm(resolved);
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved, true);

        // Hash provider for CAS node encoding (uses BLAKE3-128)
        const hashProvider = {
          hash: async (nodeData: Uint8Array): Promise<Uint8Array> => {
            const fullHash = blake3(nodeData);
            return fullHash.slice(0, 16); // 128-bit truncation
          },
        };

        // Encode file data as CAS f-node
        const encoded = await encodeFileNode(
          {
            data: new Uint8Array(data),
            contentType: contentType || "application/octet-stream",
            fileSize: data.length,
          },
          hashProvider
        );

        // Convert hash to node key format
        const nodeKey = hashToNodeKey(encoded.hash);

        // Upload the encoded node
        const result = await api.putNode(
          resolved.baseUrl,
          resolved.realm,
          accessToken,
          nodeKey,
          encoded.bytes
        );
        if (!result.ok) {
          formatter.error(`Failed to upload: ${result.error.message}`);
          process.exit(1);
        }

        // Cache the encoded CAS node (raw bytes, same as what server stores)
        if (opts.cache !== false && nodeKey) {
          setCachedNode(nodeKey, Buffer.from(encoded.bytes));
        }

        formatter.output({ key: nodeKey, size: data.length, status: result.data.status }, () => nodeKey);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  node
    .command("info <key>")
    .description("Show node metadata")
    .requiredOption("-i, --index-path <path>", "CAS index path for scope verification")
    .action(async (key: string, cmdOpts: { indexPath: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved, false);

        const result = await api.getNodeMetadata(
          resolved.baseUrl,
          resolved.realm,
          accessToken,
          key,
          cmdOpts.indexPath
        );
        if (!result.ok) {
          formatter.error(`Failed to get metadata: ${result.error.message}`);
          process.exit(1);
        }

        const info = result.data;
        formatter.output(info, () => {
          const lines = [
            `Key:          ${key}`,
            `Kind:         ${info.kind}`,
            `Size:         ${formatSize(info.payloadSize)}`,
          ];
          if (info.kind === "file") {
            lines.push(`Content-Type: ${info.contentType}`);
            if (info.successor) {
              lines.push(`Successor:    ${info.successor}`);
            }
          }
          if (info.kind === "dict") {
            lines.push(`Children:     ${Object.keys(info.children).length}`);
          }
          return lines.join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  node
    .command("cat <key>")
    .description("Output file content to stdout (decodes CAS node)")
    .requiredOption("-i, --index-path <path>", "CAS index path for scope verification")
    .action(async (key: string, cmdOpts: { indexPath: string }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved, false);

        // Helper to fetch node bytes (with caching)
        const getNodeBytes = async (nodeKey: string): Promise<Uint8Array> => {
          // Check cache first
          if (opts.cache !== false && hasCachedNode(nodeKey)) {
            const cached = getCachedNode(nodeKey);
            if (cached) return new Uint8Array(cached);
          }

          const result = await api.getNode(
            resolved.baseUrl,
            resolved.realm,
            accessToken,
            nodeKey,
            cmdOpts.indexPath
          );
          if (!result.ok) {
            throw new Error(`Failed to get node ${nodeKey}: ${result.error.message}`);
          }

          // Cache the raw node
          if (opts.cache !== false) {
            setCachedNode(nodeKey, Buffer.from(result.data));
          }

          return result.data;
        };

        // Fetch and decode the root node
        const rootBytes = await getNodeBytes(key);
        const casNode = decodeNode(rootBytes);

        if (casNode.kind === "dict") {
          formatter.error("Cannot cat a directory node. Use 'node info' to see contents.");
          process.exit(1);
        }

        // Extract file content from f-node or s-node
        if (casNode.data) {
          process.stdout.write(Buffer.from(casNode.data));
        }
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  node
    .command("exists <keys...>")
    .description("Check if nodes exist (for upload preparation)")
    .action(async (keys: string[]) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);
        requireAuth(resolved);

        const accessToken = await ensureAccessToken(resolved, true);

        const result = await api.prepareNodes(resolved.baseUrl, resolved.realm, accessToken, {
          keys,
        });
        if (!result.ok) {
          formatter.error(`Failed to check nodes: ${result.error.message}`);
          process.exit(1);
        }

        const missing = result.data.missing || [];
        const status = keys.map((key) => ({
          key,
          exists: !missing.includes(key),
        }));

        formatter.output(status, () => {
          return status.map((s) => `${s.exists ? "✓" : "✗"} ${s.key}`).join("\n");
        });
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });
}

function getDefaultFilename(key: string): string {
  // Extract node ID from key
  const nodeId = key.startsWith("node:") ? key.slice(5) : key;
  return nodeId.slice(0, 12);
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".txt": "text/plain",
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".md": "text/markdown",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
  };
  return types[ext] || "application/octet-stream";
}
