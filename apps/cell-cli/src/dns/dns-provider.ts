import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "../generators/types.js";

export type AwsCliFn = (
  args: string[],
  env: Record<string, string | undefined>,
  opts?: { pipeStderr?: boolean }
) => Promise<{ exitCode: number; stdout: string }>;

export interface DnsProvider {
  /** Pre-deploy: ensure ACM certificate exists and is issued. Returns ARN, or null if CFN handles it. */
  ensureCertificate(
    domain: string,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>
  ): Promise<string | null>;

  /** Generate CloudFormation resources for DNS (Route53 records, ACM cert, etc.) */
  generateCfnResources(config: ResolvedConfig): CfnFragment;

  /** Post-deploy: ensure DNS records point to CloudFront. */
  ensureDnsRecords(
    domain: string,
    cloudfrontDomain: string
  ): Promise<void>;

  /** Pre-deploy checks for DNS conflicts. Throws PreDeployCheckError if issues found. */
  preDeployChecks(
    config: ResolvedConfig,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>,
    stackExists: boolean,
    cellDir: string
  ): Promise<void>;
}
