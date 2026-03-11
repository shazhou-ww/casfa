/** DNS config for stack-level domain: provider + optional zone/zoneId/apiToken. */
export interface StackDnsConfig {
  provider: "route53" | "cloudflare";
  /** Route53: root domain name (e.g. casfa.shazhou.me). Omit for Cloudflare. */
  zone?: string;
  zoneId?: string;
  apiToken?: string;
}

/** Domain config in stack.yaml: single host and optional DNS/certificate. */
export interface StackDomainConfig {
  /** Full host (e.g. casfa.shazhou.me). */
  host: string;
  /** DNS provider config for this domain. */
  dns?: StackDnsConfig | "route53" | "cloudflare";
  /** ACM certificate ARN. If omitted, auto-created via DNS validation. */
  certificate?: string;
}

/** Root stack.yaml shape: cells list and optional domain/bucket suffix. */
export interface StackYaml {
  /** Cell names or paths (e.g. sso, agent or apps/sso). */
  cells: string[];
  /** Optional single-domain config for platform deploy. */
  domain?: StackDomainConfig;
  /** Optional suffix for S3 bucket names to avoid global collisions. */
  bucketNameSuffix?: string;
}
