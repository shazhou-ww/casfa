import * as fs from "node:fs";
import * as path from "node:path";
import { decodeNode, encodeFileNode } from "@casfa/core";
import { hashToNodeKey } from "@casfa/protocol";
import { blake3 } from "@noble/hashes/blake3.js";
import type { Command } from "commander";
import { getCachedNode, hasCachedNode, setCachedNode } from "../lib/cache";
import { createClient, requireRealm } from "../lib/client";
import { createFormatter, formatSize } from "../lib/output";

export function registerNodeCommands(program: Command): void {
  const node = program.command("node").description("Node operations (content-addressable storage)");

  node
    .command("get <key>")
    .description("Download a file from a node key")
    .option("-o, --output <path>", "output file path")
    .option("--raw", "save raw node bytes without decoding")
    .action(async (key: string, cmdOpts: { output?: string; raw?: boolean }) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        // Helper to fetch node bytes (with caching)
        const getNodeBytes = async (nodeKey: string): Promise<Uint8Array> => {
          // Check cache first
          if (opts.cache !== false && hasCachedNode(nodeKey)) {
            const cached = getCachedNode(nodeKey);
            if (cached) return new Uint8Array(cached);
          }

          const result = await resolved.client.nodes.get(nodeKey);
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
        const node = decodeNode(rootBytes);

        if (node.kind === "dict") {
          formatter.error("Cannot download a directory node as file. Use --raw to get raw bytes.");
          process.exit(1);
        }

        if (!node.data) {
          formatter.error("Node has no data content.");
          process.exit(1);
        }

        const outputPath = cmdOpts.output || getDefaultFilename(key);
        fs.writeFileSync(outputPath, Buffer.from(node.data));
        formatter.success(`Downloaded ${formatSize(node.data.length)} to ${outputPath}`);
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

        // Upload the encoded node using put (not upload, since we have the key)
        const result = await resolved.client.nodes.put(nodeKey, { data: encoded.bytes });
        if (!result.ok) {
          formatter.error(`Failed to upload: ${result.error.message}`);
          process.exit(1);
        }

        // Cache the encoded CAS node (raw bytes, same as what server stores)
        if (opts.cache !== false && nodeKey) {
          setCachedNode(nodeKey, Buffer.from(encoded.bytes));
        }

        formatter.output({ key: nodeKey, size: data.length }, () => nodeKey);
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  node
    .command("info <key>")
    .description("Show node metadata")
    .action(async (key: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        const result = await resolved.client.nodes.getMetadata(key);
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
    .action(async (key: string) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        // Helper to fetch node bytes (with caching)
        const getNodeBytes = async (nodeKey: string): Promise<Uint8Array> => {
          // Check cache first
          if (opts.cache !== false && hasCachedNode(nodeKey)) {
            const cached = getCachedNode(nodeKey);
            if (cached) return new Uint8Array(cached);
          }

          const result = await resolved.client.nodes.get(nodeKey);
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
        const node = decodeNode(rootBytes);

        if (node.kind === "dict") {
          formatter.error("Cannot cat a directory node. Use 'node info' to see contents.");
          process.exit(1);
        }

        // Extract file content from f-node or s-node
        if (node.data) {
          process.stdout.write(Buffer.from(node.data));
        }
      } catch (error) {
        formatter.error((error as Error).message);
        process.exit(1);
      }
    });

  node
    .command("exists <keys...>")
    .description("Check if nodes exist")
    .action(async (keys: string[]) => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      try {
        const resolved = await createClient(opts);
        requireRealm(resolved);

        const result = await resolved.client.nodes.prepare({ keys });
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
