/**
 * Delegate and DelegateStore types per facade-delegate design.
 * Paths are string only (e.g. "foo", "foo/bar").
 */

import type { BytesStream, CasFacade, CasNodeResult } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";

/** Shared delegate fields (limited/unlimited). */
export type DelegateBase = {
  delegateId: string;
  realmId: string;
  parentId: string | null;
  mountPath: string;
};

/** Limited-lifecycle delegate: single token, expires at expiresAt. */
export type DelegateLimited = DelegateBase & {
  lifetime: "limited";
  accessTokenHash: string;
  expiresAt: number;
};

/** Unlimited-lifecycle delegate: access + refresh tokens. */
export type DelegateUnlimited = DelegateBase & {
  lifetime: "unlimited";
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: number;
};

export type Delegate = DelegateLimited | DelegateUnlimited;

export type DelegateStore = {
  getDelegate(delegateId: string): Promise<Delegate | null>;
  getRoot(delegateId: string): Promise<string | null>;
  setRoot(delegateId: string, nodeKey: string): Promise<void>;
  listDelegates(realmId: string): Promise<Delegate[]>;
  insertDelegate(delegate: Delegate): Promise<void>;
  removeDelegate(delegateId: string): Promise<void>;
  updateDelegatePath(delegateId: string, newPath: string): Promise<void>;
  setClosed(delegateId: string): Promise<void>;
  purgeExpiredDelegates(expiredBefore: number): Promise<number>;
};

/**
 * Options when creating a delegate: ttl present = limited, absent = unlimited.
 */
export type DelegateOptions = {
  ttl?: number;
};

export type RealmInfo = {
  lastGcTime: number | null;
  nodeCount: number;
  totalBytes: number;
  delegateCount: number;
};

/** DelegateFacade shape: base methods; path is string only. */
export type DelegateFacadeBase = {
  readonly delegateId: string;
  readonly accessToken: string;
  getNode(path: string): Promise<CasNodeResult | null>;
  hasNode(path: string): Promise<boolean>;
  putNode(nodeKey: string, body: BytesStream): Promise<void>;
  commit(newRootKey: string, oldRootKey: string): Promise<void>;
  createChildDelegate(relativePath: string, options: DelegateOptions): Promise<DelegateFacade>;
  close(): Promise<void>;
};

export type DelegateFacadeLimited = DelegateFacadeBase & {
  readonly lifetime: "limited";
  readonly expiresAt: number;
};

export type DelegateFacadeUnlimited = DelegateFacadeBase & {
  readonly lifetime: "unlimited";
  readonly refreshToken: string;
  readonly accessExpiresAt: number;
  refresh(): Promise<DelegateFacadeUnlimited>;
};

export type DelegateFacade = DelegateFacadeLimited | DelegateFacadeUnlimited;

export type RealmFacadeContext = {
  cas: CasFacade;
  delegateStore: DelegateStore;
  /** Required for close() path updates; not in abstract design but needed by impl */
  key: KeyProvider;
  maxLimitedTtlMs?: number;
};

export type RealmFacade = {
  createRootDelegate(realmId: string, options: DelegateOptions): Promise<DelegateFacade>;
  gc(realmId: string, cutOffTime: number): Promise<void>;
  info(realmId: string): Promise<RealmInfo>;
};
