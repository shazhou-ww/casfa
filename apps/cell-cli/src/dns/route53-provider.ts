import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "../generators/types.js";
import type { AwsCliFn, DnsProvider } from "./dns-provider.js";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PreDeployCheckError } from "../commands/deploy-checks.js";

export class Route53Provider implements DnsProvider {
  async ensureCertificate(
    _domain: string,
    _awsCli: AwsCliFn,
    _awsEnv: Record<string, string | undefined>
  ): Promise<string | null> {
    return null;
  }

  generateCfnResources(config: ResolvedConfig): CfnFragment {
    const resources: Record<string, unknown> = {};
    if (!config.domain || !config.domain.hostedZoneId) {
      return { Resources: resources };
    }

    resources.DnsRecord = {
      Type: "AWS::Route53::RecordSet",
      Condition: "UseCustomDomain",
      Properties: {
        Type: "A",
        Name: config.domain.host,
        HostedZoneName: `${config.domain.zone}.`,
        AliasTarget: {
          DNSName: { "Fn::GetAtt": ["FrontendCloudFront", "DomainName"] },
          HostedZoneId: "Z2FDTNDATAQYW2",
        },
      },
    };

    return { Resources: resources };
  }

  async ensureDnsRecords(_domain: string, _cloudfrontDomain: string): Promise<void> {}

  async preDeployChecks(
    config: ResolvedConfig,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>,
    stackExists: boolean,
    cellDir: string
  ): Promise<void> {
    if (!config.domain?.host) return;
    const needsResourceChecks = !stackExists;
    if (!needsResourceChecks) return;

    const host = config.domain.host;
    const zone = config.domain.zone;

    const { exitCode: hzCode, stdout: hzOut } = await awsCli(
      [
        "route53", "list-hosted-zones-by-name",
        "--dns-name", zone,
        "--max-items", "1",
        "--query", "HostedZones[0].[Id,Name]",
        "--output", "json",
      ],
      awsEnv,
      { pipeStderr: true }
    );
    if (hzCode !== 0 || !hzOut) return;
    const parsed = JSON.parse(hzOut) as string[];
    if (!parsed[1]?.startsWith(zone)) return;
    const hostedZoneId = parsed[0].replace("/hostedzone/", "");

    const { exitCode: rrCode, stdout: rrOut } = await awsCli(
      [
        "route53", "list-resource-record-sets",
        "--hosted-zone-id", hostedZoneId,
        "--query", `ResourceRecordSets[?Name=='${host}.']`,
        "--output", "json",
      ],
      awsEnv,
      { pipeStderr: true }
    );
    if (rrCode !== 0 || !rrOut) return;

    type R53Record = {
      Name: string;
      Type: string;
      AliasTarget?: { DNSName: string; HostedZoneId: string; EvaluateTargetHealth: boolean };
      TTL?: number;
      ResourceRecords?: Array<{ Value: string }>;
    };
    const records = JSON.parse(rrOut) as R53Record[];
    const conflicting = records.filter((r) => r.Type === "A" || r.Type === "AAAA");
    if (conflicting.length === 0) return;

    const types = conflicting.map((r) => r.Type).join(", ");
    throw new PreDeployCheckError(
      `DNS record(s) for "${host}" already exist (${types}) and would block stack creation.\n` +
        `  → This often happens after a failed deploy: the stack was deleted but DNS records were retained.`,
      {
        description: `Delete the existing DNS record(s) for "${host}" (${types}) so this stack can create them.`,
        apply: async () => {
          const changeBatch = JSON.stringify({
            Changes: conflicting.map((r) => ({
              Action: "DELETE",
              ResourceRecordSet: r,
            })),
          });
          mkdirSync(resolve(cellDir, ".cell"), { recursive: true });
          const tmpPath = resolve(cellDir, ".cell/dns-delete-batch.json");
          writeFileSync(tmpPath, changeBatch);
          try {
            const { exitCode: delCode } = await awsCli(
              [
                "route53", "change-resource-record-sets",
                "--hosted-zone-id", hostedZoneId,
                "--change-batch", `file://${tmpPath}`,
              ],
              awsEnv
            );
            if (delCode !== 0) throw new Error(`Failed to delete DNS records for ${host}`);
            console.log(`  Deleted ${conflicting.length} DNS record(s) for ${host}`);
          } finally {
            if (existsSync(tmpPath)) unlinkSync(tmpPath);
          }
        },
      }
    );
  }
}
