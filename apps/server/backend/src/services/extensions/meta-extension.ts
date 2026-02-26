/**
 * Built-in "meta" extension — Node Metadata
 *
 * Generates lightweight metadata (kind, size, contentType, childCount)
 * for every f-node and d-node. This data is exactly what `ls` needs
 * to display directory listings without fetching full child node blobs.
 *
 * Timing: on-create — metadata is cheap to extract and almost always needed.
 *
 * Schema (DerivedRecord.data):
 *   { kind: "file"|"dict", size: number|null, contentType: string|null, childCount: number|null }
 */

import type { NodeExtensionDef } from "./index.ts";

export const META_EXTENSION_NAME = "meta";

/**
 * Shape of data stored by the meta extension.
 */
export type NodeMetaData = {
  /** Node kind: "file" or "dict" */
  kind: "file" | "dict";
  /** File size in bytes (f-node only, null for d-nodes) */
  size: number | null;
  /** MIME content type (f-node only, null for d-nodes) */
  contentType: string | null;
  /** Number of direct children (d-node only, null for f-nodes) */
  childCount: number | null;
};

/**
 * Built-in "meta" extension definition.
 *
 * Targets all f-nodes and d-nodes. Generates on node creation.
 * On-demand fallback ensures backwards compatibility with nodes
 * created before this extension was deployed.
 */
export const metaExtension: NodeExtensionDef<NodeMetaData> = {
  name: META_EXTENSION_NAME,
  contentTypes: ["*"],
  timing: "on-create",

  generate: async (ctx) => {
    const { node } = ctx;

    if (node.kind === "dict") {
      return {
        kind: "dict",
        size: null,
        contentType: null,
        childCount: node.children?.length ?? 0,
      };
    }

    // f-node
    return {
      kind: "file",
      size: node.fileInfo?.fileSize ?? node.data?.length ?? 0,
      contentType: node.fileInfo?.contentType ?? "application/octet-stream",
      childCount: null,
    };
  },
};
