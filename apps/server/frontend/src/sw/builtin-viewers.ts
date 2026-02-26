/**
 * Built-in Viewers — well-known viewer DAGs for /view composition
 *
 * Each viewer is a d-node containing at minimum an `index.js` that self-executes.
 * The index.js uses the convention:
 *   - `fetch("_target/")` → JSON dir listing of the target DAG
 *   - `fetch("_target/{name}")` → content of a file in the target DAG
 *
 * Viewers are encoded as real CAS nodes (f-node for JS, d-node for directory)
 * using the same binary format as any other CAS content. They are stored in
 * the virtual overlay cache so they don't pollute persistent storage.
 *
 * Viewer source files live in ./viewers/*.js and are inlined at build time
 * via Vite's ?raw import, giving them proper syntax highlighting and linting.
 */

import {
  encodeDictNode,
  encodeFileNode,
  hashToKey,
  keyToHash,
  type KeyProvider,
} from "@casfa/core";
import { storageKeyToNodeKey } from "@casfa/protocol";

// Vite ?raw imports — inlined as strings at build time
import IMAGE_GALLERY_JS from "./viewers/image-gallery.js?raw";
import SLIDESHOW_JS from "./viewers/slideshow.js?raw";
import TEXT_VIEWER_JS from "./viewers/text-viewer.js?raw";

// ============================================================================
// Registry & Initialization
// ============================================================================

export interface BuiltinViewer {
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Storage key of the viewer d-node */
  storageKey: string;
  /** Node key (nod_XXX) of the viewer d-node */
  nodeKey: string;
  /** Supported content type patterns (e.g. "image/*", "text/*") */
  contentTypes: string[];
}

const textEncoder = new TextEncoder();

/**
 * Encode a JS string as a CAS f-node and store it in the provided map.
 * Returns the storage key.
 */
async function encodeJsFile(
  js: string,
  keyProvider: KeyProvider,
  store: Map<string, Uint8Array>
): Promise<string> {
  const data = textEncoder.encode(js);
  const encoded = await encodeFileNode(
    { data, contentType: "text/javascript", fileSize: data.length },
    keyProvider
  );
  const storageKey = hashToKey(encoded.hash);
  store.set(storageKey, encoded.bytes);
  return storageKey;
}

/**
 * Build a viewer d-node from a set of {name, storageKey} entries.
 * Returns the storage key of the d-node.
 */
async function buildViewerNode(
  entries: Array<{ name: string; storageKey: string }>,
  keyProvider: KeyProvider,
  store: Map<string, Uint8Array>
): Promise<string> {
  const children = entries.map((e) => keyToHash(e.storageKey));
  const childNames = entries.map((e) => e.name);
  const encoded = await encodeDictNode({ children, childNames }, keyProvider);
  const storageKey = hashToKey(encoded.hash);
  store.set(storageKey, encoded.bytes);
  return storageKey;
}

let builtinViewers: BuiltinViewer[] | null = null;

/**
 * Initialize built-in viewers. Encodes JS files and d-nodes into CAS format
 * and stores them in the provided virtual overlay map.
 * Returns the list of available viewers.
 */
export async function initBuiltinViewers(
  keyProvider: KeyProvider,
  virtualStore: Map<string, Uint8Array>
): Promise<BuiltinViewer[]> {
  if (builtinViewers) return builtinViewers;

  const viewers: BuiltinViewer[] = [];

  // --- Image Gallery ---
  const galleryJsKey = await encodeJsFile(IMAGE_GALLERY_JS, keyProvider, virtualStore);
  const galleryKey = await buildViewerNode(
    [{ name: "index.js", storageKey: galleryJsKey }],
    keyProvider,
    virtualStore
  );
  viewers.push({
    name: "Image Gallery",
    description: "Grid view of images from the target directory",
    storageKey: galleryKey,
    nodeKey: storageKeyToNodeKey(galleryKey),
    contentTypes: ["image/*"],
  });

  // --- Slideshow ---
  const slideshowJsKey = await encodeJsFile(SLIDESHOW_JS, keyProvider, virtualStore);
  const slideshowKey = await buildViewerNode(
    [{ name: "index.js", storageKey: slideshowJsKey }],
    keyProvider,
    virtualStore
  );
  viewers.push({
    name: "Slideshow",
    description: "Fullscreen slideshow of images with autoplay and keyboard controls",
    storageKey: slideshowKey,
    nodeKey: storageKeyToNodeKey(slideshowKey),
    contentTypes: ["image/*"],
  });

  // --- Text Viewer ---
  const textJsKey = await encodeJsFile(TEXT_VIEWER_JS, keyProvider, virtualStore);
  const textViewerKey = await buildViewerNode(
    [{ name: "index.js", storageKey: textJsKey }],
    keyProvider,
    virtualStore
  );
  viewers.push({
    name: "Text Viewer",
    description: "Browse and read text files from the target directory",
    storageKey: textViewerKey,
    nodeKey: storageKeyToNodeKey(textViewerKey),
    contentTypes: ["text/*"],
  });

  builtinViewers = viewers;
  return viewers;
}
