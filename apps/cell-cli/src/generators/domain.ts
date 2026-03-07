import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";

export function generateDomain(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};

  if (!config.domain) return { Resources: resources };

  // Cloudflare DNS is managed outside CloudFormation
  const dnsProvider = config.domain.dns ?? "route53";
  if (dnsProvider === "cloudflare") return { Resources: resources };

  // Route53: only generate if hostedZoneId is available
  if (!config.domain.hostedZoneId) return { Resources: resources };

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
