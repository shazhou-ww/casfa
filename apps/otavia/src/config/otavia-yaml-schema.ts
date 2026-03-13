/**
 * Schema types for otavia.yaml
 */

export interface OtaviaYamlDns {
  provider?: string;
  zone?: string;
  zoneId?: string;
}

export interface OtaviaYamlDomain {
  host: string;
  dns?: OtaviaYamlDns;
}

/** One cell in the stack: mount path segment (e.g. "sso") and its package (e.g. "@casfa/sso"). */
export interface CellEntry {
  mount: string;
  package: string;
  params?: Record<string, unknown>;
}

/**
 * cellsList is the canonical form: ordered list of { package, mount, params? }.
 * cells keeps a compatibility map mount -> package for display/legacy behavior.
 */
export interface OtaviaYaml {
  stackName: string;
  /** mount -> package (for display/serialization). Use cellsList for iteration. */
  cells: Record<string, string>;
  /** Ordered list of { mount, package }; first is default/first cell. */
  cellsList: CellEntry[];
  domain: OtaviaYamlDomain;
  params?: Record<string, unknown>;
}
