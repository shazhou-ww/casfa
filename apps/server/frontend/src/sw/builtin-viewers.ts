/**
 * Built-in Viewers — well-known viewer DAGs for /view composition
 *
 * Each viewer is a d-node containing:
 *   - manifest.json — viewer metadata (name, icon, entry, contentTypes)
 *   - index.js      — default entry script (self-executing)
 *
 * The manifest.json follows the ViewerManifest schema and MUST have
 * `"casfa": "viewer"` to identify the folder as a CASFA viewer.
 *
 * The bootstrap HTML (served by SW for /view composition) loads
 * manifest.json first, then dynamically loads the entry script.
 *
 * Viewers are encoded as real CAS nodes (f-node for each file, d-node for
 * directory) using the same binary format as any other CAS content. They are
 * stored in the virtual overlay cache so they don't pollute persistent storage.
 *
 * Viewer source files live in ./viewers/*.js and are inlined at build time
 * via Vite's ?raw import, giving them proper syntax highlighting and linting.
 */

import type { ViewerManifest } from "@casfa/client-bridge";
import {
  encodeDictNode,
  encodeFileNode,
  hashToKey,
  type KeyProvider,
  keyToHash,
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
 * Encode a text string as a CAS f-node and store it in the provided map.
 * Returns the storage key.
 */
async function encodeTextFile(
  text: string,
  contentType: string,
  keyProvider: KeyProvider,
  store: Map<string, Uint8Array>
): Promise<string> {
  const data = textEncoder.encode(text);
  const encoded = await encodeFileNode({ data, contentType, fileSize: data.length }, keyProvider);
  const storageKey = hashToKey(encoded.hash);
  store.set(storageKey, encoded.bytes);
  return storageKey;
}

/**
 * Encode a ViewerManifest as a CAS f-node (application/json).
 * Returns the storage key.
 */
async function encodeManifest(
  manifest: ViewerManifest,
  keyProvider: KeyProvider,
  store: Map<string, Uint8Array>
): Promise<string> {
  return encodeTextFile(JSON.stringify(manifest, null, 2), "application/json", keyProvider, store);
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
 * Initialize built-in viewers. Encodes manifest.json + JS files as CAS nodes
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
  const galleryManifest: ViewerManifest = {
    casfa: "viewer",
    name: "Image Gallery",
    description: "Grid view of images from the target directory",
    contentTypes: ["image/*"],
  };
  const galleryManifestKey = await encodeManifest(galleryManifest, keyProvider, virtualStore);
  const galleryJsKey = await encodeTextFile(
    IMAGE_GALLERY_JS,
    "text/javascript",
    keyProvider,
    virtualStore
  );
  const galleryKey = await buildViewerNode(
    [
      { name: "manifest.json", storageKey: galleryManifestKey },
      { name: "index.js", storageKey: galleryJsKey },
    ],
    keyProvider,
    virtualStore
  );
  viewers.push({
    name: galleryManifest.name,
    description: galleryManifest.description ?? "",
    storageKey: galleryKey,
    nodeKey: storageKeyToNodeKey(galleryKey),
    contentTypes: galleryManifest.contentTypes,
  });

  // --- Slideshow ---
  const slideshowManifest: ViewerManifest = {
    casfa: "viewer",
    name: "Slideshow",
    description: "Fullscreen slideshow of images with autoplay and keyboard controls",
    contentTypes: ["image/*"],
  };
  const slideshowManifestKey = await encodeManifest(slideshowManifest, keyProvider, virtualStore);
  const slideshowJsKey = await encodeTextFile(
    SLIDESHOW_JS,
    "text/javascript",
    keyProvider,
    virtualStore
  );
  const slideshowKey = await buildViewerNode(
    [
      { name: "manifest.json", storageKey: slideshowManifestKey },
      { name: "index.js", storageKey: slideshowJsKey },
    ],
    keyProvider,
    virtualStore
  );
  viewers.push({
    name: slideshowManifest.name,
    description: slideshowManifest.description ?? "",
    storageKey: slideshowKey,
    nodeKey: storageKeyToNodeKey(slideshowKey),
    contentTypes: slideshowManifest.contentTypes,
  });

  // --- Text Viewer ---
  const textManifest: ViewerManifest = {
    casfa: "viewer",
    name: "Text Viewer",
    description: "Browse and read text files from the target directory",
    contentTypes: ["text/*"],
  };
  const textManifestKey = await encodeManifest(textManifest, keyProvider, virtualStore);
  const textJsKey = await encodeTextFile(
    TEXT_VIEWER_JS,
    "text/javascript",
    keyProvider,
    virtualStore
  );
  const textViewerKey = await buildViewerNode(
    [
      { name: "manifest.json", storageKey: textManifestKey },
      { name: "index.js", storageKey: textJsKey },
    ],
    keyProvider,
    virtualStore
  );
  viewers.push({
    name: textManifest.name,
    description: textManifest.description ?? "",
    storageKey: textViewerKey,
    nodeKey: storageKeyToNodeKey(textViewerKey),
    contentTypes: textManifest.contentTypes,
  });

  builtinViewers = viewers;
  return viewers;
}
