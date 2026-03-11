import type { ResolvedConfig } from "../config/resolve-config.js";
import type { CfnFragment } from "../generators/types.js";
import type { AwsCliFn, DnsProvider } from "./dns-provider.js";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareProvider implements DnsProvider {
  constructor(
    private readonly zoneId: string,
    private readonly apiToken: string
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  generateCfnResources(_config: ResolvedConfig): CfnFragment {
    return { Resources: {} };
  }

  async ensureCertificate(
    domain: string,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>
  ): Promise<string | null> {
    const existing = await this.findExistingCert(domain, awsCli, awsEnv);
    if (existing) {
      console.log(`  Using existing ACM certificate: ${existing}`);
      return existing;
    }

    console.log(`  Requesting ACM certificate for ${domain}...`);
    const { exitCode, stdout } = await awsCli(
      [
        "acm", "request-certificate",
        "--domain-name", domain,
        "--validation-method", "DNS",
        "--region", "us-east-1",
        "--output", "json",
      ],
      awsEnv
    );
    if (exitCode !== 0) {
      throw new Error(`Failed to request ACM certificate for ${domain}`);
    }
    const { CertificateArn } = JSON.parse(stdout) as { CertificateArn: string };
    console.log(`  Certificate requested: ${CertificateArn}`);

    await this.createValidationRecords(CertificateArn, awsCli, awsEnv);
    await this.waitForCertIssued(CertificateArn, awsCli, awsEnv);

    return CertificateArn;
  }

  async ensureDnsRecords(domain: string, cloudfrontDomain: string): Promise<void> {
    console.log(`  Setting DNS: ${domain} → ${cloudfrontDomain}`);
    await this.upsertDnsRecord("CNAME", domain, cloudfrontDomain, false);
    console.log(`  DNS record created/updated`);
  }

  async preDeployChecks(
    _config: ResolvedConfig,
    _awsCli: AwsCliFn,
    _awsEnv: Record<string, string | undefined>,
    _stackExists: boolean,
    _cellDir: string
  ): Promise<void> {}

  private async findExistingCert(
    domain: string,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>
  ): Promise<string | null> {
    const { exitCode, stdout } = await awsCli(
      [
        "acm", "list-certificates",
        "--region", "us-east-1",
        "--output", "json",
      ],
      awsEnv,
      { pipeStderr: true }
    );
    if (exitCode !== 0 || !stdout) return null;
    const data = JSON.parse(stdout) as {
      CertificateSummaryList: Array<{
        DomainName: string;
        CertificateArn: string;
        Status: string;
      }>;
    };
    const match = data.CertificateSummaryList.find(
      (c) => c.DomainName === domain && c.Status === "ISSUED"
    );
    return match?.CertificateArn ?? null;
  }

  private async createValidationRecords(
    certArn: string,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>
  ): Promise<void> {
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      const { exitCode, stdout } = await awsCli(
        [
          "acm", "describe-certificate",
          "--certificate-arn", certArn,
          "--region", "us-east-1",
          "--output", "json",
        ],
        awsEnv
      );
      if (exitCode !== 0) throw new Error("Failed to describe certificate");

      const cert = JSON.parse(stdout) as {
        Certificate: {
          DomainValidationOptions: Array<{
            ResourceRecord?: { Name: string; Type: string; Value: string };
            ValidationStatus: string;
          }>;
        };
      };

      const options = cert.Certificate.DomainValidationOptions;
      const withRecords = options.filter((o) => o.ResourceRecord);

      if (withRecords.length > 0) {
        for (const opt of withRecords) {
          if (opt.ValidationStatus === "SUCCESS") continue;
          const rr = opt.ResourceRecord!;
          const name = rr.Name.replace(/\.$/, "");
          const value = rr.Value.replace(/\.$/, "");
          console.log(`  Creating validation record: ${name} → ${value}`);
          await this.upsertDnsRecord("CNAME", name, value, false);
        }
        return;
      }

      attempts++;
      console.log(`  Waiting for validation records... (${attempts}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("Timed out waiting for ACM validation records");
  }

  private async waitForCertIssued(
    certArn: string,
    awsCli: AwsCliFn,
    awsEnv: Record<string, string | undefined>
  ): Promise<void> {
    console.log("  Waiting for certificate to be issued...");
    const maxWaitMs = 300_000;
    const pollMs = 10_000;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const { exitCode, stdout } = await awsCli(
        [
          "acm", "describe-certificate",
          "--certificate-arn", certArn,
          "--region", "us-east-1",
          "--output", "json",
        ],
        awsEnv,
        { pipeStderr: true }
      );
      if (exitCode === 0 && stdout) {
        const data = JSON.parse(stdout) as { Certificate: { Status: string } };
        const status = data.Certificate.Status;
        if (status === "ISSUED") {
          console.log("  Certificate issued!");
          return;
        }
        const remaining = Math.round((deadline - Date.now()) / 1000);
        console.log(`  Certificate status: ${status} (${remaining}s remaining)`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      `Certificate ${certArn} was not issued within 5 minutes. Check ACM console for validation status.`
    );
  }

  private async upsertDnsRecord(
    type: string,
    name: string,
    content: string,
    proxied: boolean
  ): Promise<void> {
    const listUrl =
      `${CF_API_BASE}/zones/${this.zoneId}/dns_records?type=${type}&name=${name}`;
    const listRes = await fetch(listUrl, { headers: this.headers() });
    const listData = (await listRes.json()) as {
      success: boolean;
      result: Array<{ id: string; content: string }>;
      errors?: Array<{ message: string }>;
    };
    if (!listData.success) {
      const msg = listData.errors?.map((e) => e.message).join(", ") ?? "unknown error";
      throw new Error(`Cloudflare API error listing records: ${msg}`);
    }

    const body = JSON.stringify({ type, name, content, proxied, ttl: 1 });

    if (listData.result.length > 0) {
      const recordId = listData.result[0].id;
      if (listData.result[0].content === content) return;
      const updateRes = await fetch(
        `${CF_API_BASE}/zones/${this.zoneId}/dns_records/${recordId}`,
        { method: "PUT", headers: this.headers(), body }
      );
      const updateData = (await updateRes.json()) as { success: boolean; errors?: Array<{ message: string }> };
      if (!updateData.success) {
        const msg = updateData.errors?.map((e) => e.message).join(", ") ?? "unknown error";
        throw new Error(`Cloudflare API error updating record: ${msg}`);
      }
    } else {
      const createRes = await fetch(
        `${CF_API_BASE}/zones/${this.zoneId}/dns_records`,
        { method: "POST", headers: this.headers(), body }
      );
      const createData = (await createRes.json()) as { success: boolean; errors?: Array<{ message: string }> };
      if (!createData.success) {
        const msg = createData.errors?.map((e) => e.message).join(", ") ?? "unknown error";
        throw new Error(`Cloudflare API error creating record: ${msg}`);
      }
    }
  }
}
