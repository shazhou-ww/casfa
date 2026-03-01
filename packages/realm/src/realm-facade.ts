/**
 * Realm facade and delegate facade implementation per design.
 */
import type { CasFacade } from "@casfa/cas";
import { bytesFromStream, streamFromBytes } from "@casfa/cas";
import type { CasNode, KeyProvider } from "@casfa/core";
import { decodeNode, encodeDictNode, hashToKey, keyToHash } from "@casfa/core";
import { createRealmError } from "./errors.ts";
import type {
  Delegate,
  DelegateFacade,
  DelegateFacadeLimited,
  DelegateFacadeUnlimited,
  DelegateOptions,
  DelegateStore,
  DelegateUnlimited,
  RealmFacade,
  RealmFacadeContext,
  RealmInfo,
} from "./types.ts";

/** Hash a token string for storage (hex). */
async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pathToSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

async function getNodeDecoded(cas: CasFacade, key: string): Promise<CasNode | null> {
  const result = await cas.getNode(key);
  if (!result) return null;
  const bytes = await bytesFromStream(result.body);
  return decodeNode(bytes);
}

function resolveSegment(node: CasNode, segment: string): string | null {
  const children = node.children;
  if (!children || children.length === 0) return null;
  if (node.kind === "dict") {
    const names = node.childNames;
    if (names) {
      const nameIdx = names.indexOf(segment);
      if (nameIdx >= 0) return hashToKey(children[nameIdx]!);
    }
    const num = parseInt(segment, 10);
    if (String(num) === segment && num >= 0 && num < children.length)
      return hashToKey(children[num]!);
    return null;
  }
  if (node.kind === "set") {
    const num = parseInt(segment, 10);
    if (String(num) === segment && num >= 0 && num < children.length)
      return hashToKey(children[num]!);
    return null;
  }
  return null;
}

async function resolvePath(
  cas: CasFacade,
  getRoot: () => Promise<string | null>,
  segments: string[]
): Promise<string | null> {
  const rootKey = await getRoot();
  if (rootKey === null) return null;
  if (segments.length === 0) return rootKey;
  let key = rootKey;
  for (const segment of segments) {
    const node = await getNodeDecoded(cas, key);
    if (!node) return null;
    const nextKey = resolveSegment(node, segment);
    if (nextKey === null) return null;
    key = nextKey;
  }
  return key;
}

async function replaceDictEntry(
  cas: CasFacade,
  keyProvider: KeyProvider,
  nodeKey: string,
  replaceName: string,
  replaceKey: string
): Promise<{ newKey: string; bytes: Uint8Array }> {
  const node = await getNodeDecoded(cas, nodeKey);
  if (!node || node.kind !== "dict") throw createRealmError("InvalidPath", "node is not a dict");
  const names = node.childNames ?? [];
  const children = node.children ?? [];
  const nameIdx = names.indexOf(replaceName);
  if (nameIdx < 0) throw createRealmError("InvalidPath", `entry ${replaceName} not found`);
  const newChildren = children.slice();
  const newNames = names.slice();
  newChildren[nameIdx] = keyToHash(replaceKey);
  const encoded = await encodeDictNode(
    { children: newChildren, childNames: newNames },
    keyProvider
  );
  return { newKey: hashToKey(encoded.hash), bytes: encoded.bytes };
}

async function replaceSubtreeAtPath(
  cas: CasFacade,
  keyProvider: KeyProvider,
  nodeKey: string,
  segments: string[],
  newChildKey: string
): Promise<string> {
  if (segments.length === 0) throw createRealmError("InvalidPath", "mount path must not be empty");
  const node = await getNodeDecoded(cas, nodeKey);
  if (!node || node.kind !== "dict") throw createRealmError("InvalidPath", "node is not a dict");
  if (segments.length === 1) {
    const { newKey, bytes } = await replaceDictEntry(
      cas,
      keyProvider,
      nodeKey,
      segments[0]!,
      newChildKey
    );
    await cas.putNode(newKey, streamFromBytes(bytes));
    return newKey;
  }
  const firstKey = resolveSegment(node, segments[0]!);
  if (firstKey === null)
    throw createRealmError("InvalidPath", `path segment ${segments[0]} not found`);
  const newFirstKey = await replaceSubtreeAtPath(
    cas,
    keyProvider,
    firstKey,
    segments.slice(1),
    newChildKey
  );
  const { newKey, bytes } = await replaceDictEntry(
    cas,
    keyProvider,
    nodeKey,
    segments[0]!,
    newFirstKey
  );
  await cas.putNode(newKey, streamFromBytes(bytes));
  return newKey;
}

export type RealmFacadeContextWithKey = RealmFacadeContext;

/**
 * Create a DelegateFacade implementation bound to a delegate.
 */
function createDelegateFacade(
  delegate: Delegate,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: number,
  accessExpiresAt: number,
  cas: CasFacade,
  store: DelegateStore,
  keyProvider: KeyProvider
): DelegateFacade {
  const delegateId = delegate.delegateId;
  const getRoot = () => store.getRoot(delegateId);

  const base = {
    delegateId,
    accessToken,
    async getNode(path: string) {
      const segments = pathToSegments(path);
      const keyResolved = await resolvePath(cas, getRoot, segments);
      if (keyResolved === null) return null;
      return cas.getNode(keyResolved);
    },
    async hasNode(path: string) {
      const segments = pathToSegments(path);
      const keyResolved = await resolvePath(cas, getRoot, segments);
      if (keyResolved === null) return false;
      return cas.hasNode(keyResolved);
    },
    putNode(nodeKey: string, body: ReadableStream<Uint8Array>) {
      return cas.putNode(nodeKey, body);
    },
    async commit(newRootKey: string, oldRootKey: string) {
      const current = await getRoot();
      if (current !== oldRootKey) throw createRealmError("CommitConflict");
      await store.setRoot(delegateId, newRootKey);
    },
    async createChildDelegate(relativePath: string, options: DelegateOptions) {
      const segments = pathToSegments(relativePath);
      const childRootKey = await resolvePath(cas, getRoot, segments);
      if (childRootKey === null)
        throw createRealmError("InvalidPath", "path does not resolve under current root");
      const childId = crypto.randomUUID();
      const ttlMs = options.ttl;
      const now = Date.now();
      const childAccessToken = crypto.randomUUID();
      const childAccessHash = await hashToken(childAccessToken);
      let childDelegate: Delegate;
      let childRefreshToken: string | null = null;
      let childExpiresAt = 0;
      let childAccessExpiresAt = 0;
      if (ttlMs !== undefined && ttlMs > 0) {
        childExpiresAt = now + ttlMs;
        childDelegate = {
          lifetime: "limited",
          delegateId: childId,
          realmId: delegate.realmId,
          parentId: delegateId,
          mountPath: relativePath,
          accessTokenHash: childAccessHash,
          expiresAt: childExpiresAt,
        };
      } else {
        childRefreshToken = crypto.randomUUID();
        const childRefreshHash = await hashToken(childRefreshToken);
        childAccessExpiresAt = now + 3600_000;
        childDelegate = {
          lifetime: "unlimited",
          delegateId: childId,
          realmId: delegate.realmId,
          parentId: delegateId,
          mountPath: relativePath,
          accessTokenHash: childAccessHash,
          refreshTokenHash: childRefreshHash,
          accessExpiresAt: childAccessExpiresAt,
        };
      }
      await store.insertDelegate(childDelegate);
      await store.setRoot(childId, childRootKey);
      return createDelegateFacade(
        childDelegate,
        childAccessToken,
        childRefreshToken,
        childExpiresAt,
        childAccessExpiresAt,
        cas,
        store,
        keyProvider
      ) as DelegateFacade;
    },
    async close() {
      const parentId = delegate.parentId;
      if (parentId === null) throw createRealmError("InvalidPath", "cannot close root delegate");
      const mountPath = delegate.mountPath;
      const segments = pathToSegments(mountPath);
      if (segments.length === 0)
        throw createRealmError("InvalidPath", "mount path must not be empty");
      const childRootKey = await getRoot();
      if (childRootKey === null) throw createRealmError("NotFound", "delegate has no root");
      const parentRootKey = await store.getRoot(parentId);
      if (parentRootKey === null) throw createRealmError("NotFound", "parent has no root");
      const newParentRootKey = await replaceSubtreeAtPath(
        cas,
        keyProvider,
        parentRootKey,
        segments,
        childRootKey
      );
      const parent = await store.getDelegate(parentId);
      if (!parent) throw createRealmError("NotFound", "parent delegate not found");
      const current = await store.getRoot(parentId);
      if (current !== parentRootKey) throw createRealmError("CommitConflict");
      await store.setRoot(parentId, newParentRootKey);
      await store.setClosed(delegateId);
    },
  };

  if (delegate.lifetime === "limited") {
    return {
      ...base,
      lifetime: "limited",
      expiresAt,
    } as DelegateFacadeLimited;
  }

  return {
    ...base,
    lifetime: "unlimited",
    refreshToken: refreshToken!,
    accessExpiresAt,
    async refresh() {
      const updated = await store.getDelegate(delegateId);
      if (!updated || updated.lifetime !== "unlimited")
        throw createRealmError("NotFound", "delegate not found or not unlimited");
      const newAccess = crypto.randomUUID();
      const newAccessHash = await hashToken(newAccess);
      const newAccessExpiresAt = Date.now() + 3600_000;
      const updatedEntity: DelegateUnlimited = {
        ...updated,
        accessTokenHash: newAccessHash,
        accessExpiresAt: newAccessExpiresAt,
      };
      await store.insertDelegate(updatedEntity);
      return createDelegateFacade(
        updatedEntity,
        newAccess,
        refreshToken,
        0,
        newAccessExpiresAt,
        cas,
        store,
        keyProvider
      ) as DelegateFacadeUnlimited;
    },
  } as DelegateFacade;
}

/**
 * Create initial empty dict root key in CAS and return it.
 */
async function ensureEmptyRoot(cas: CasFacade, keyProvider: KeyProvider): Promise<string> {
  const encoded = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
  const key = hashToKey(encoded.hash);
  const exists = await cas.hasNode(key);
  if (exists) return key;
  await cas.putNode(key, streamFromBytes(encoded.bytes));
  return key;
}

export function createRealmFacade(ctx: RealmFacadeContext): RealmFacade {
  const { cas, delegateStore, key, maxLimitedTtlMs } = ctx;

  return {
    async createRootDelegate(realmId: string, options: DelegateOptions) {
      const list = await delegateStore.listDelegates(realmId);
      let main = list.find((d) => d.parentId === null);
      const now = Date.now();
      const accessToken = crypto.randomUUID();
      const accessHash = await hashToken(accessToken);
      const ttlMs = options.ttl;
      let refreshToken: string | null = null;
      let expiresAt = 0;
      let accessExpiresAt = 0;

      if (main) {
        if (ttlMs !== undefined && ttlMs > 0) {
          const capped = maxLimitedTtlMs != null ? Math.min(ttlMs, maxLimitedTtlMs) : ttlMs;
          expiresAt = now + capped;
          main = {
            ...main,
            lifetime: "limited",
            accessTokenHash: accessHash,
            expiresAt,
          };
        } else {
          refreshToken = crypto.randomUUID();
          const refreshHash = await hashToken(refreshToken);
          accessExpiresAt = now + 3600_000;
          main = {
            ...main,
            lifetime: "unlimited",
            accessTokenHash: accessHash,
            refreshTokenHash: refreshHash,
            accessExpiresAt,
          };
        }
        await delegateStore.insertDelegate(main);
      } else {
        const delegateId = crypto.randomUUID();
        const emptyRootKey = await ensureEmptyRoot(cas, key);
        if (ttlMs !== undefined && ttlMs > 0) {
          const capped = maxLimitedTtlMs != null ? Math.min(ttlMs, maxLimitedTtlMs) : ttlMs;
          expiresAt = now + capped;
          main = {
            lifetime: "limited",
            delegateId,
            realmId,
            parentId: null,
            mountPath: "",
            accessTokenHash: accessHash,
            expiresAt,
          };
        } else {
          refreshToken = crypto.randomUUID();
          const refreshHash = await hashToken(refreshToken);
          accessExpiresAt = now + 3600_000;
          main = {
            lifetime: "unlimited",
            delegateId,
            realmId,
            parentId: null,
            mountPath: "",
            accessTokenHash: accessHash,
            refreshTokenHash: refreshHash,
            accessExpiresAt,
          };
        }
        await delegateStore.insertDelegate(main);
        await delegateStore.setRoot(delegateId, emptyRootKey);
      }
      return createDelegateFacade(
        main,
        accessToken,
        refreshToken,
        expiresAt,
        accessExpiresAt,
        cas,
        delegateStore,
        key
      );
    },

    async gc(realmId: string, cutOffTime: number) {
      const delegates = await delegateStore.listDelegates(realmId);
      const rootKeys = new Set<string>();
      for (const d of delegates) {
        const root = await delegateStore.getRoot(d.delegateId);
        if (root !== null) rootKeys.add(root);
      }
      await cas.gc([...rootKeys], cutOffTime);
    },

    async info(realmId: string): Promise<RealmInfo> {
      const casInfo = await cas.info();
      const delegates = await delegateStore.listDelegates(realmId);
      return {
        lastGcTime: casInfo.lastGcTime,
        nodeCount: casInfo.nodeCount,
        totalBytes: casInfo.totalBytes,
        delegateCount: delegates.length,
      };
    },
  };
}
