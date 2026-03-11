/**
 * Schema for stack.yaml at repo root (platform mode).
 * Used by cell build/deploy when run from a directory that contains stack.yaml.
 */
export interface StackDomainConfig {
  host: string;
  dns?: { provider: string; zone?: string; zoneId?: string };
  certificate?: string;
}

export interface StackYaml {
  /** Cell names or paths (e.g. sso, agent → apps/sso, apps/agent). */
  cells: string[];
  domain?: StackDomainConfig;
  bucketNameSuffix?: string;
}
