/**
 * RealmService: single-root file tree, delegate tree, local commit, GC.
 */

import type { PathSegment } from "@casfa/cas-uri";
import {
  decodeNode,
  encodeDictNode,
  encodeFileNode,
  getWellKnownNodeData,
  hashToKey,
  makeDict,
} from "@casfa/core";
import type { KeyProvider } from "@casfa/core";
import type { CasNode } from "@casfa/core";
import type { RealmError } from "./errors.ts";
import { generateDelegateId } from "./id.ts";
import { replaceSubtreeAtPath } from "./merge.ts";
import type { MergeContext } from "./merge.ts";
import { resolvePath, validateNameOnlyPath } from "./path.ts";
import type { GetNode } from "./path.ts";
import type { BlobStore, DelegateDb } from "./storage.ts";
import type { Delegate, RealmStats } from "./types.ts";

export type RealmServiceDeps = {
  blob: BlobStore;
  db: DelegateDb;
  key: KeyProvider;
  generateDelegateId?: () => string;
};

export type CreateRootDelegateOptions = { name?: string };
export type CreateChildDelegateOptions = { name?: string };

export type ReadResult =
  | { ok: true; node: CasNode; key: string }
  | { ok: false; error: RealmError };
export type PutResult = { ok: true; key: string } | { ok: false; error: RealmError };
export type CommitResult = { ok: true; newRootKey: string } | { ok: false; error: RealmError };

export class RealmService {
  readonly #blob: BlobStore;
  readonly #db: DelegateDb;
  readonly #key: KeyProvider;
  readonly #genId: () => string;

  constructor(deps: RealmServiceDeps) {
    this.#blob = deps.blob;
    this.#db = deps.db;
    this.#key = deps.key;
    this.#genId = deps.generateDelegateId ?? generateDelegateId;
  }

  #getNode: GetNode = async (key: string) => {
    const data = getWellKnownNodeData(key) ?? (await this.#blob.get(key));
    if (!data) return null;
    return decodeNode(data);
  };

  #ctx() {
    return { storage: this.#blob, key: this.#key };
  }

  #mergeCtx(): MergeContext {
    return { getNode: this.#getNode, makeDict, ctx: this.#ctx() };
  }

  async createRootDelegate(
    realmId: string,
    options?: CreateRootDelegateOptions
  ): Promise<Delegate> {
    const delegateId = this.#genId();
    const delegate: Delegate = {
      delegateId,
      realmId,
      parentId: null,
      boundPath: [],
      name: options?.name,
      createdAt: Date.now(),
    };
    await this.#db.insertDelegate(delegate);
    return delegate;
  }

  async createChildDelegate(
    parentDelegateId: string,
    relativePath: PathSegment[],
    options?: CreateChildDelegateOptions
  ): Promise<Delegate | RealmError> {
    const parent = await this.#db.getDelegate(parentDelegateId);
    if (!parent) return { code: "NotFound", message: "Delegate not found" };

    const err = validateNameOnlyPath(relativePath);
    if (err) return err;

    const rootKey = await this.#db.getRoot(parent.realmId);
    if (!rootKey) return { code: "NoRoot", message: "Realm has no root" };

    const logicalRoot = await resolvePath(rootKey, parent.boundPath, this.#getNode);
    if ("code" in logicalRoot) return logicalRoot;

    const resolved = await resolvePath(logicalRoot.key, relativePath, this.#getNode);
    if ("code" in resolved) return resolved;

    const targetNode = await this.#getNode(resolved.key);
    if (!targetNode) return { code: "NotFound", message: "Target node not found" };
    if (targetNode.kind === "successor") {
      return { code: "InvalidPath", message: "Cannot bind to successor node" };
    }

    const boundPath: PathSegment[] = [...parent.boundPath, ...relativePath];
    const delegateId = this.#genId();
    const delegate: Delegate = {
      delegateId,
      realmId: parent.realmId,
      parentId: parentDelegateId,
      boundPath,
      name: options?.name,
      createdAt: Date.now(),
    };
    await this.#db.insertDelegate(delegate);
    return delegate;
  }

  async read(delegateId: string, relativePath: PathSegment[]): Promise<ReadResult> {
    const delegate = await this.#db.getDelegate(delegateId);
    if (!delegate) return { ok: false, error: { code: "NotFound", message: "Delegate not found" } };

    const rootKey = await this.#db.getRoot(delegate.realmId);
    if (!rootKey) return { ok: false, error: { code: "NoRoot", message: "Realm has no root" } };

    const logicalRoot = await resolvePath(rootKey, delegate.boundPath, this.#getNode);
    if ("code" in logicalRoot) return { ok: false, error: logicalRoot };

    const resolved = await resolvePath(logicalRoot.key, relativePath, this.#getNode, {
      allowSuccessor: true,
    });
    if ("code" in resolved) return { ok: false, error: resolved };

    const node = await this.#getNode(resolved.key);
    if (!node) return { ok: false, error: { code: "NotFound", message: "Node not found" } };

    return { ok: true, node, key: resolved.key };
  }

  async put(
    delegateId: string,
    relativePath: PathSegment[],
    payload: { kind: "dict"; entries: { name: string; key: string }[] } | { kind: "file"; data: Uint8Array; contentType?: string }
  ): Promise<PutResult> {
    const delegate = await this.#db.getDelegate(delegateId);
    if (!delegate) return { ok: false, error: { code: "NotFound", message: "Delegate not found" } };

    if (payload.kind === "dict") {
      const key = await makeDict(this.#ctx(), payload.entries);
      const bytes = await this.#blob.get(key);
      if (bytes) {
        await this.#db.incrementRealmStats(delegate.realmId, 1, bytes.length);
      }
      return { ok: true, key };
    }

    const enc = await encodeFileNode(
      { data: payload.data, contentType: payload.contentType, fileSize: payload.data.length },
      this.#key
    );
    const key = hashToKey(enc.hash);
    await this.#blob.put(key, enc.bytes);
    await this.#db.incrementRealmStats(delegate.realmId, 1, enc.bytes.length);
    return { ok: true, key };
  }

  async commit(
    delegateId: string,
    baseLocalRoot: string,
    newLocalRoot: string
  ): Promise<CommitResult> {
    const delegate = await this.#db.getDelegate(delegateId);
    if (!delegate) return { ok: false, error: { code: "NotFound", message: "Delegate not found" } };

    const rootKey = await this.#db.getRoot(delegate.realmId);
    if (!rootKey) return { ok: false, error: { code: "NoRoot", message: "Realm has no root" } };

    const current = await resolvePath(rootKey, delegate.boundPath, this.#getNode);
    if ("code" in current) return { ok: false, error: current };
    if (current.key !== baseLocalRoot) {
      return { ok: false, error: { code: "CommitConflict", message: "Base local root mismatch" } };
    }

    const newRootKey = await replaceSubtreeAtPath(
      rootKey,
      delegate.boundPath,
      newLocalRoot,
      this.#mergeCtx()
    );
    await this.#db.setRoot(delegate.realmId, newRootKey);
    return { ok: true, newRootKey };
  }

  async listReachableKeys(realmId: string): Promise<Set<string>> {
    const rootKey = await this.#db.getRoot(realmId);
    if (!rootKey) return new Set();

    const seen = new Set<string>();
    const queue = [rootKey];
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = await this.#getNode(key);
      if (node?.children) {
        for (const h of node.children) {
          queue.push(hashToKey(h));
        }
      }
    }
    return seen;
  }

  async gcSweep(realmId: string): Promise<void> {
    const keysToRetain = await this.listReachableKeys(realmId);
    await this.#blob.sweep(keysToRetain);
    let totalBytes = 0;
    for (const k of keysToRetain) {
      const data = await this.#blob.get(k);
      if (data) totalBytes += data.length;
    }
    await this.#db.setRealmStats(realmId, { nodeCount: keysToRetain.size, totalBytes });
  }

  async getRealmStats(realmId: string): Promise<RealmStats | null> {
    return this.#db.getRealmStats(realmId);
  }
}
