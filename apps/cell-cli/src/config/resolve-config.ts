import type {
  BackendConfig,
  CellConfig,
  DomainConfig,
  FrontendConfig,
  NetworkConfig,
  ResolvedDomainConfig,
  ResolvedValue,
  SecretRef,
  StaticMapping,
  TableConfig,
  TestingConfig,
} from "./cell-yaml-schema.js";
import { isEnvRef, isSecretRef } from "./cell-yaml-schema.js";
import { getDevHost, loadDevboxConfig, type DevboxConfig } from "./devbox-config.js";

export type Stage = "dev" | "test" | "cloud";

/** Thrown when required params are missing from env; catch in CLI to exit with a clean message */
export class MissingParamsError extends Error {
  readonly missingLines: string[];
  readonly cellName: string;
  readonly stage: Stage;

  constructor(cellName: string, stage: Stage, missingLines: string[]) {
    const message = [
      "",
      `Missing required params for "${cellName}" (stage=${stage}):`,
      ...missingLines,
      "",
      "Add them to your .env files, then retry.",
      "",
    ].join("\n");
    super(message);
    this.name = "MissingParamsError";
    this.missingLines = missingLines;
    this.cellName = cellName;
    this.stage = stage;
  }
}

export interface ResolvedTable {
  key: string;
  tableName: string;
  config: TableConfig;
}

export interface ResolvedBucket {
  key: string;
  bucketName: string;
}

export interface ResolvedConfig {
  name: string;
  envVars: Record<string, string>;
  secretRefs: Record<string, string>;
  tables: ResolvedTable[];
  buckets: ResolvedBucket[];
  frontendBucketName: string;
  backend?: BackendConfig;
  frontend?: FrontendConfig;
  static?: StaticMapping[];
  /** Resolved list of domains from config.domains */
  domains?: ResolvedDomainConfig[];
  /** Primary domain (domains[0]) for backward compatibility and CELL_BASE_URL */
  domain?: ResolvedDomainConfig;
  network?: NetworkConfig;
  testing?: TestingConfig;
}

function resourceName(appName: string, key: string, stage: Stage): string {
  return stage === "cloud" ? `${appName}-${key}` : `${appName}-${stage}-${key}`;
}

const S3_BUCKET_NAME_MAX = 63;
const BUCKET_SUFFIX_REGEX = /^[a-z0-9-]{1,50}$/;

/** Bucket name for cloud uses optional suffix to reduce global name collisions. */
function bucketResourceName(
  appName: string,
  key: string,
  stage: Stage,
  suffix?: string
): string {
  if (stage !== "cloud" || !suffix) {
    return resourceName(appName, key, stage);
  }
  const normalized = suffix.toLowerCase().trim();
  if (!BUCKET_SUFFIX_REGEX.test(normalized)) {
    throw new Error(
      `Invalid bucketNameSuffix "${suffix}": must be 1-50 characters, only lowercase letters, digits, and hyphens (e.g. mycompany or my-org-42).`
    );
  }
  const name = `${key}-${appName}-${normalized}`;
  if (name.length > S3_BUCKET_NAME_MAX) {
    throw new Error(
      `Bucket name "${name}" exceeds S3 limit of ${S3_BUCKET_NAME_MAX} characters. Use a shorter bucketNameSuffix.`
    );
  }
  return name;
}

export function resolveConfig(
  config: CellConfig,
  envMap: Record<string, string>,
  stage: Stage,
  options?: {
    onMissingParam?: "throw" | "placeholder";
    /** When provided (including null), overrides loadDevboxConfig() for dev stage. Use null in tests to force no devbox. */
    devboxConfigOverride?: DevboxConfig | null;
  }
): ResolvedConfig {
  const onMissing = options?.onMissingParam ?? "throw";
  const envVars: Record<string, string> = {};
  const secretRefs: Record<string, string> = {};

  const hasBuckets = config.buckets && Object.keys(config.buckets).length > 0;
  const hasFrontend = !!config.frontend;
  const needsBucketSuffix = stage === "cloud" && (hasBuckets || hasFrontend);
  if (needsBucketSuffix && !config.bucketNameSuffix?.trim()) {
    throw new Error(
      `Missing bucketNameSuffix in cell.yaml for cloud deploy.\n` +
        `  → S3 bucket names are globally unique. Add a suffix to avoid collisions, e.g.:\n` +
        `     bucketNameSuffix: mycompany   # or your org name / account id`
    );
  }

  // 1. Params → env vars (all params are required)
  const missingParams: string[] = [];
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      if (typeof value === "string") {
        envVars[key] = value;
      } else if (isSecretRef(value)) {
        secretRefs[key] = value.secret;
        const envValue = envMap[value.secret];
        if (envValue === undefined) {
          if (onMissing === "placeholder") {
            envVars[key] = `<${key}>`;
          } else {
            missingParams.push(`  ${key}: !Secret "${value.secret}" not found in env`);
          }
        } else {
          envVars[key] = envValue;
        }
      } else if (isEnvRef(value)) {
        const envValue = envMap[value.env];
        if (envValue === undefined) {
          if (onMissing === "placeholder") {
            envVars[key] = `<${key}>`;
          } else {
            missingParams.push(`  ${key}: !Env "${value.env}" not found in env`);
          }
        } else {
          envVars[key] = envValue;
        }
      }
    }
  }
  if (missingParams.length > 0) {
    throw new MissingParamsError(config.name, stage, missingParams);
  }

  // 2. Tables → resolved names + auto env vars
  const tables: ResolvedTable[] = [];
  if (config.tables) {
    for (const [key, tableConfig] of Object.entries(config.tables)) {
      const tableName = resourceName(config.name, key, stage);
      tables.push({ key, tableName, config: tableConfig });
      envVars[`DYNAMODB_TABLE_${key.toUpperCase()}`] = tableName;
    }
  }

  // 3. Buckets → resolved names + auto env vars
  const buckets: ResolvedBucket[] = [];
  if (config.buckets) {
    for (const key of Object.keys(config.buckets)) {
      const bucketName = bucketResourceName(
        config.name,
        key,
        stage,
        config.bucketNameSuffix
      );
      buckets.push({ key, bucketName });
      envVars[`S3_BUCKET_${key.toUpperCase()}`] = bucketName;
    }
  }

  // 4. Frontend bucket
  const frontendBucketName = bucketResourceName(
    config.name,
    "frontend",
    stage,
    config.bucketNameSuffix
  );
  envVars.FRONTEND_BUCKET = frontendBucketName;

  // 5. Local endpoints (dev/test only)
  if (stage !== "cloud") {
    const portBase = parseInt(envMap.PORT_BASE ?? "7100", 10);
    const offset = stage === "dev" ? 0 : 10;
    envVars.DYNAMODB_ENDPOINT = `http://localhost:${portBase + offset + 2}`;
    envVars.S3_ENDPOINT = `http://localhost:${portBase + offset + 4}`;
  }

  // Resolve top-level Cloudflare API token (shared by domains that omit domain.cloudflare.apiToken)
  const topLevelCloudflareToken =
    config.cloudflare?.apiToken != null
      ? envMap[config.cloudflare.apiToken.secret] ??
        (onMissing === "placeholder" ? `<${config.cloudflare.apiToken.secret}>` : "")
      : undefined;

  // 6. Resolve domains config (single domain or multiple)
  const domains: ResolvedDomainConfig[] = [];
  const deriveZoneFromHost = (host: string): string =>
    host.includes(".") ? host.split(".").slice(1).join(".") : host;
  const pushResolvedDomain = (d: DomainConfig, alias: string) => {
    const subdomainFromConfig = resolveValueToString(d.subdomain, envVars, envMap);
    const subdomain = (envVars.SUBDOMAIN ?? envMap.SUBDOMAIN ?? subdomainFromConfig).trim();
    if (!subdomain) {
      throw new Error("domain.subdomain is required (e.g. sso.casfa, drive.casfa), or set params.SUBDOMAIN.");
    }
    const domainRoot = envVars.DOMAIN_ROOT ?? envMap.DOMAIN_ROOT ?? "";
    let host: string;
    if (stage === "cloud") {
      if (!domainRoot.trim()) {
        throw new MissingParamsError(config.name, stage, [
          "  DOMAIN_ROOT: required when domain.subdomain is set (e.g. shazhou.me).",
        ]);
      }
      host = `${subdomain}.${domainRoot}`;
    } else if (stage === "dev") {
      const devbox =
        options?.devboxConfigOverride !== undefined
          ? options.devboxConfigOverride
          : loadDevboxConfig();
      // Dev host must use the cell's domain.subdomain only (e.g. sso.casfa), not env SUBDOMAIN.
      // Otherwise instance overrides (e.g. SUBDOMAIN=sso for symbiont) or mistaken env values
      // (e.g. SUBDOMAIN=mymbp.symbiontlabs.me) would produce wrong hosts like mymbp.symbiontlabs.me.mymbp.shazhou.work.
      const devSubdomain = subdomainFromConfig.trim();
      host = devbox && devSubdomain ? getDevHost(devSubdomain, devbox) : "";
    } else {
      host = domainRoot.trim() ? `${subdomain}.${domainRoot}` : "";
    }
    let zone: string;
    if (d.dns !== undefined && typeof d.dns === "object" && d.dns !== null && "provider" in d.dns) {
      const dnsObj = d.dns as {
        provider: string;
        zone?: ResolvedValue;
        zoneId?: ResolvedValue;
        apiToken?: SecretRef;
      };
      if (dnsObj.provider === "route53") {
        if (dnsObj.zone == null) {
          throw new Error(
            'When DNS provider is route53, DNS.zone (root domain) is required. Example: DNS: { provider: route53, zone: "example.com" }'
          );
        }
        zone = resolveValueToString(dnsObj.zone, envVars, envMap);
      } else if (dnsObj.provider === "cloudflare") {
        zone = deriveZoneFromHost(host);
      } else {
        zone = d.zone != null ? resolveValueToString(d.zone, envVars, envMap) : deriveZoneFromHost(host);
      }
    } else {
      zone = d.zone != null ? resolveValueToString(d.zone, envVars, envMap) : deriveZoneFromHost(host);
    }
    const domain: ResolvedDomainConfig = { alias, zone, host, subdomain };
    let dnsProvider: "route53" | "cloudflare" | undefined;
    let cloudflareZoneId: ResolvedValue | undefined;
    let cloudflareApiToken: SecretRef | undefined;

    if (d.dns !== undefined) {
      if (typeof d.dns === "object" && d.dns !== null && "provider" in d.dns) {
        const dnsObj = d.dns as { provider: string; zoneId?: ResolvedValue; apiToken?: SecretRef };
        if (dnsObj.provider === "route53" || dnsObj.provider === "cloudflare") {
          dnsProvider = dnsObj.provider;
          if (dnsObj.provider === "cloudflare") {
            cloudflareZoneId = dnsObj.zoneId;
            cloudflareApiToken = dnsObj.apiToken;
          }
        }
      } else {
        const rawDns = isEnvRef(d.dns)
          ? resolveValueToString(d.dns, envVars, envMap)
          : (d.dns as string);
        if (rawDns === "cloudflare" || rawDns === "route53") {
          dnsProvider = rawDns;
          if (rawDns === "cloudflare" && d.cloudflare) {
            cloudflareZoneId = d.cloudflare.zoneId;
            cloudflareApiToken = d.cloudflare.apiToken;
          }
        }
      }
    }
    if (dnsProvider) domain.dns = dnsProvider;
    if (d.certificate) {
      domain.certificate = resolveValueToString(d.certificate, envVars, envMap);
    }
    if (domain.dns === "cloudflare") {
      const zoneId =
        cloudflareZoneId != null
          ? resolveValueToString(cloudflareZoneId, envVars, envMap)
          : "";
      const apiTokenFromDomain =
        cloudflareApiToken != null
          ? envMap[cloudflareApiToken.secret] ??
            (onMissing === "placeholder" ? `<${cloudflareApiToken.secret}>` : "")
          : undefined;
      const apiToken =
        apiTokenFromDomain ??
        topLevelCloudflareToken ??
        (onMissing === "placeholder" ? "<cloudflare.apiToken>" : "");
      if (!apiToken) {
        throw new MissingParamsError(config.name, stage, [
          "  cloudflare.apiToken: set dns.apiToken or top-level cloudflare.apiToken (!Secret) and add to env",
        ]);
      }
      domain.cloudflare = { zoneId, apiToken };
    }
    domains.push(domain);
  };

  if (config.domain) {
    // Single domain: one entry with alias "default" (no --domain needed for deploy)
    pushResolvedDomain(config.domain, "default");
  } else {
    const domainsEntries: [string, DomainConfig][] = Array.isArray(config.domains)
      ? config.domains.map((d, i) => [String(i), d] as [string, DomainConfig])
      : config.domains && typeof config.domains === "object"
        ? Object.entries(config.domains)
        : [];
    const isLegacyArray = Array.isArray(config.domains);
    for (const [aliasKey, d] of domainsEntries) {
      const alias = isLegacyArray ? resolveValueToString(d.subdomain, envVars, envMap) : aliasKey;
      pushResolvedDomain(d, alias);
    }
  }
  const domain = domains[0];

  // 7. Standard Cell env vars (CELL_STAGE, CELL_BASE_URL)
  envVars.CELL_STAGE = stage;
  if (domain?.host) {
    if (stage === "cloud" || stage === "dev") {
      envVars.CELL_BASE_URL = `https://${domain.host}`;
    }
  }

  return {
    name: config.name,
    envVars,
    secretRefs,
    tables,
    buckets,
    frontendBucketName,
    backend: config.backend,
    frontend: config.frontend,
    static: config.static,
    domains: domains.length ? domains : undefined,
    domain,
    network: config.network,
    testing: config.testing,
  };
}

/** Resolve a ResolvedValue to a string using envVars (merged params, including instance overrides) and envMap (.env). */
function resolveValueToString(
  value: ResolvedValue,
  envVars: Record<string, string>,
  envMap: Record<string, string>
): string {
  if (typeof value === "string") return value;
  if (isEnvRef(value)) return envVars[value.env] ?? envMap[value.env] ?? "";
  if (isSecretRef(value)) return envVars[value.secret] ?? envMap[value.secret] ?? "";
  return "";
}
