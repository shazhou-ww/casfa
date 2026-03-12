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

export interface OtaviaYaml {
  stackName: string;
  cells: string[];
  domain: OtaviaYamlDomain;
  params?: Record<string, unknown>;
}
