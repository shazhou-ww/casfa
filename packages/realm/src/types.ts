/**
 * Depot: a workspace in a realm with an optional parent and mount path.
 * parentId === null means main (root) depot.
 * mountPath is path segments (e.g. ["foo", "bar"]) or a single string path.
 */
export type Depot = {
  depotId: string;
  realmId: string;
  /** null = main depot */
  parentId: string | null;
  /** Path segments or string path where this depot is mounted under parent */
  mountPath: string[] | string;
};

/**
 * Store for depot metadata and roots.
 * getRoot/setRoot manage the current root node key per depot.
 */
export type DepotStore = {
  getDepot(depotId: string): Promise<Depot | null>;
  getRoot(depotId: string): Promise<string | null>;
  setRoot(depotId: string, nodeKey: string): Promise<void>;
  listDepots(realmId: string): Promise<Depot[]>;
  insertDepot(depot: Depot): Promise<void>;
  removeDepot(depotId: string): Promise<void>;
  /** Mark depot as closed (optional; some impls may use removeDepot instead). */
  setClosed?(depotId: string): Promise<void>;
};
