import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "./types.js";

export function generateDomain(config: ResolvedConfig): CfnFragment {
  const resources: Record<string, unknown> = {};

  if (!config.domain) return { Resources: resources };

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
