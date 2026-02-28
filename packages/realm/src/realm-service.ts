import type { CasService } from "@casfa/cas";
import type { DepotStore } from "./types.ts";

export type RealmServiceContext = {
  cas: CasService;
  depotStore: DepotStore;
};

export class RealmService {
  readonly cas: CasService;
  readonly depotStore: DepotStore;

  constructor(ctx: RealmServiceContext) {
    this.cas = ctx.cas;
    this.depotStore = ctx.depotStore;
  }

  async createDepot(_parentDepotId: string, _path: string): Promise<unknown> {
    throw new Error("not implemented");
  }

  async commitDepot(_depotId: string, _newRoot: string, _oldRoot: string): Promise<void> {
    throw new Error("not implemented");
  }

  async closeDepot(_depotId: string): Promise<void> {
    throw new Error("not implemented");
  }

  async getNode(_depotId: string, _path: string): Promise<unknown> {
    throw new Error("not implemented");
  }

  async hasNode(_depotId: string, _path: string): Promise<boolean> {
    throw new Error("not implemented");
  }

  async putNode(_depotId: string, _path: string, _nodeKey: string, _data: Uint8Array): Promise<void> {
    throw new Error("not implemented");
  }

  async gc(_cutOffTime: number): Promise<void> {
    throw new Error("not implemented");
  }

  async info(): Promise<unknown> {
    throw new Error("not implemented");
  }
}
