/**
 * Legacy depot types; use Delegate / DelegateStore instead.
 * @deprecated
 */
export type Depot = {
  depotId: string;
  realmId: string;
  parentId: string | null;
  mountPath: string[] | string;
};

/** @deprecated Use DelegateStore */
export type DepotStore = {
  getDepot(depotId: string): Promise<Depot | null>;
  getRoot(depotId: string): Promise<string | null>;
  setRoot(depotId: string, nodeKey: string): Promise<void>;
  listDepots(realmId: string): Promise<Depot[]>;
  insertDepot(depot: Depot): Promise<void>;
  removeDepot(depotId: string): Promise<void>;
  updateDepotPath?(depotId: string, newPath: string[] | string): Promise<void>;
  setClosed?(depotId: string): Promise<void>;
};
