/**
 * Schema for top-level stack.yaml (platform mode).
 * Lists cells and global domain/DNS; each cell's pathPrefix comes from cell.yaml.
 */

export interface StackDomainConfig {
  /** Single domain host (e.g. casfa.shazhou.me) */
  host: string;
  dns?: "route53" | "cloudflare";
  certificate?: string;
}

export interface StackYaml {
  /** Cell names (e.g. sso, agent); cell.yaml is at apps/<name>/cell.yaml */
  cells: string[];
  /** Global domain for the platform */
  domain?: StackDomainConfig;
  bucketNameSuffix?: string;
}
