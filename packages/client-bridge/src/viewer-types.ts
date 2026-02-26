/**
 * Viewer management types — shared between main thread and SW.
 *
 * Defines the RPC interface for listing, adding, removing, and
 * updating viewers (both built-in and custom).
 */

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
};

/** Input for adding a custom viewer */
export type AddCustomViewerInput = {
  name: string;
  description?: string;
  contentTypes: string[];
  nodeKey: string;
};

/** Input for updating a custom viewer */
export type UpdateCustomViewerInput = {
  name?: string;
  description?: string;
  contentTypes?: string[];
  nodeKey?: string;
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
};
