/**
 * Viewer management types — shared between main thread and SW.
 *
 * Defines the RPC interface for listing, adding, removing, and
 * updating viewers (both built-in and custom).
 */

// ============================================================================
// Manifest
// ============================================================================

/**
 * CASFA Viewer manifest — stored as `manifest.json` in a viewer d-node.
 *
 * The `casfa` field MUST be `"viewer"` to identify the manifest.
 * The viewer bootstrap HTML loads this manifest first, then the entry script.
 */
export type ViewerManifest = {
  /** Marker field — must be "viewer" */
  casfa: "viewer";
  /** Display name of the viewer */
  name: string;
  /** Short description (optional) */
  description?: string;
  /** Relative path to entry JS file (default: "index.js") */
  entry?: string;
  /** Relative path to an icon image file (optional) */
  icon?: string;
  /** Supported content type patterns (e.g. ["image/*", "text/*"]) */
  contentTypes: string[];
};

// ============================================================================
// Data types
// ============================================================================

/** Unified viewer info */
export type ViewerInfo = {
  /** Unique identifier (builtin key or custom UUID) */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Supported content type patterns (e.g. "image/*", "text/*") */
  contentTypes: string[];
  /** CAS node key of the viewer d-node (nod_XXX) */
  nodeKey: string;
  /** Whether this is a built-in viewer */
  isBuiltin: boolean;
  /** Relative path to the icon image inside the viewer d-node (optional) */
  icon?: string;
};

/** Input for adding a custom viewer — derived from manifest.json */
export type AddCustomViewerInput = {
  name: string;
  description?: string;
  contentTypes: string[];
  nodeKey: string;
  icon?: string;
};

/** Input for updating a custom viewer */
export type UpdateCustomViewerInput = {
  name?: string;
  description?: string;
  contentTypes?: string[];
  nodeKey?: string;
  icon?: string;
};

// ============================================================================
// RPC interface
// ============================================================================

/** Methods available on the `viewers` namespace via RPC */
export type ViewerMethods = {
  /** List all viewers (built-in + custom) */
  listAll(): Promise<ViewerInfo[]>;
  /** List only built-in viewers */
  listBuiltin(): Promise<ViewerInfo[]>;
  /** List only custom viewers */
  listCustom(): Promise<ViewerInfo[]>;
  /** Add a custom viewer */
  addCustom(input: AddCustomViewerInput): Promise<ViewerInfo>;
  /** Remove a custom viewer by id */
  removeCustom(id: string): Promise<void>;
  /** Update a custom viewer by id */
  updateCustom(id: string, updates: UpdateCustomViewerInput): Promise<ViewerInfo>;
  /** Read manifest.json from a CAS d-node; returns null if not a viewer */
  readManifest(nodeKey: string): Promise<ViewerManifest | null>;
};
