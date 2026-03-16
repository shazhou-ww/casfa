/**
 * Cloudflare DNS + ACM certificate automation for deploy.
 * Creates ACM cert, adds DNS validation record via Cloudflare API,
 * waits for validation, then creates CNAME to CloudFront.
 */

type CloudflareDnsRecord = {
  id: string;
  name: string;
  type: string;
  content: string;
};

type AcmValidationRecord = {
  Name: string;
  Type: string;
  Value: string;
};

type AwsRunner = (
  args: string[],
  env: Record<string, string | undefined>,
  opts?: { pipeStderr?: boolean }
) => Promise<{ exitCode: number; stdout: string }>;

export type CloudflareDnsOptions = {
  domainHost: string;
  zoneId: string;
  cloudflareToken: string;
  awsEnv: Record<string, string | undefined>;
  awsCli: AwsRunner;
  region?: string;
};

async function cfApi(
  path: string,
  token: string,
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as { success: boolean; result: unknown; errors?: unknown[] };
  if (!data.success) {
    throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}

/** Request ACM certificate and return ARN. */
async function requestAcmCertificate(
  domainHost: string,
  awsCli: AwsRunner,
  awsEnv: Record<string, string | undefined>,
  region: string,
): Promise<string> {
  const { exitCode, stdout } = await awsCli(
    [
      "acm", "request-certificate",
      "--domain-name", domainHost,
      "--validation-method", "DNS",
      "--region", region,
      "--output", "json",
    ],
    awsEnv,
    { pipeStderr: true },
  );
  if (exitCode !== 0) throw new Error("Failed to request ACM certificate");
  const data = JSON.parse(stdout) as { CertificateArn: string };
  return data.CertificateArn;
}

/** Get DNS validation record from ACM certificate. Retries until available. */
async function getAcmValidationRecord(
  certArn: string,
  awsCli: AwsRunner,
  awsEnv: Record<string, string | undefined>,
  region: string,
): Promise<AcmValidationRecord> {
  for (let i = 0; i < 30; i++) {
    const { exitCode, stdout } = await awsCli(
      [
        "acm", "describe-certificate",
        "--certificate-arn", certArn,
        "--region", region,
        "--query", "Certificate.DomainValidationOptions[0].ResourceRecord",
        "--output", "json",
      ],
      awsEnv,
      { pipeStderr: true },
    );
    if (exitCode === 0) {
      const record = JSON.parse(stdout) as AcmValidationRecord | null;
      if (record?.Name && record?.Value) return record;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for ACM validation record");
}

/** Create or update a DNS record in Cloudflare. */
async function upsertCloudflareRecord(
  zoneId: string,
  token: string,
  name: string,
  type: string,
  content: string,
): Promise<void> {
  const cleanName = name.replace(/\.$/, "");
  const cleanContent = content.replace(/\.$/, "");

  // Search for existing record — use search param for partial match since
  // Cloudflare's exact name filter can miss records with zone suffix appended
  const allRecords = (await cfApi(
    `/zones/${zoneId}/dns_records?type=${type}&per_page=100`,
    token,
  )) as CloudflareDnsRecord[];
  const existing = allRecords.filter(
    (r) => r.name === cleanName || r.name.startsWith(cleanName.split(".")[0]),
  );

  if (existing.length > 0) {
    // Update existing
    await cfApi(`/zones/${zoneId}/dns_records/${existing[0].id}`, token, {
      method: "PUT",
      body: { type, name: cleanName, content: cleanContent, ttl: 1, proxied: false },
    });
  } else {
    // Create new
    await cfApi(`/zones/${zoneId}/dns_records`, token, {
      method: "POST",
      body: { type, name: cleanName, content: cleanContent, ttl: 1, proxied: false },
    });
  }
}

/** Wait for ACM certificate to be issued. */
async function waitForAcmValidation(
  certArn: string,
  awsCli: AwsRunner,
  awsEnv: Record<string, string | undefined>,
  region: string,
): Promise<void> {
  console.log("  Waiting for ACM certificate validation...");
  for (let i = 0; i < 60; i++) {
    const { exitCode, stdout } = await awsCli(
      [
        "acm", "describe-certificate",
        "--certificate-arn", certArn,
        "--region", region,
        "--query", "Certificate.Status",
        "--output", "text",
      ],
      awsEnv,
      { pipeStderr: true },
    );
    if (exitCode === 0) {
      const status = stdout.trim();
      if (status === "ISSUED") {
        console.log("  Certificate issued.");
        return;
      }
      if (status === "FAILED") {
        throw new Error("ACM certificate validation failed");
      }
    }
    if (i % 5 === 0 && i > 0) console.log(`  Still waiting... (${i * 5}s)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for ACM certificate validation (5 minutes)");
}

/** Check if an ISSUED ACM certificate already exists for the domain. */
async function findExistingCertificate(
  domainHost: string,
  awsCli: AwsRunner,
  awsEnv: Record<string, string | undefined>,
  region: string,
): Promise<string | null> {
  const { exitCode, stdout } = await awsCli(
    [
      "acm", "list-certificates",
      "--region", region,
      "--query", `CertificateSummaryList[?DomainName=='${domainHost}' && Status=='ISSUED'].CertificateArn | [0]`,
      "--output", "text",
    ],
    awsEnv,
    { pipeStderr: true },
  );
  if (exitCode !== 0) return null;
  const arn = stdout.trim();
  return arn && arn !== "None" ? arn : null;
}

/**
 * Ensure ACM certificate exists for domain with Cloudflare DNS validation.
 * Returns certificate ARN.
 */
export async function ensureAcmCertificateWithCloudflare(
  opts: CloudflareDnsOptions,
): Promise<string> {
  const region = opts.region ?? "us-east-1";

  // Check for existing valid certificate
  const existing = await findExistingCertificate(opts.domainHost, opts.awsCli, opts.awsEnv, region);
  if (existing) {
    console.log(`  Using existing ACM certificate: ${existing}`);
    return existing;
  }

  // Request new certificate
  console.log(`  Requesting ACM certificate for ${opts.domainHost}...`);
  const certArn = await requestAcmCertificate(opts.domainHost, opts.awsCli, opts.awsEnv, region);
  console.log(`  Certificate ARN: ${certArn}`);

  // Get validation record
  const validationRecord = await getAcmValidationRecord(certArn, opts.awsCli, opts.awsEnv, region);
  console.log(`  Adding DNS validation record to Cloudflare...`);

  // Create validation record in Cloudflare
  await upsertCloudflareRecord(
    opts.zoneId,
    opts.cloudflareToken,
    validationRecord.Name,
    validationRecord.Type,
    validationRecord.Value,
  );
  console.log(`  DNS record created: ${validationRecord.Name}`);

  // Wait for validation
  await waitForAcmValidation(certArn, opts.awsCli, opts.awsEnv, region);

  return certArn;
}

/**
 * Create CNAME record pointing domain to CloudFront distribution.
 */
export async function createCloudFrontDnsRecord(
  opts: {
    domainHost: string;
    cloudFrontDomain: string;
    zoneId: string;
    cloudflareToken: string;
  },
): Promise<void> {
  console.log(`  Creating DNS record: ${opts.domainHost} → ${opts.cloudFrontDomain}`);
  await upsertCloudflareRecord(
    opts.zoneId,
    opts.cloudflareToken,
    opts.domainHost,
    "CNAME",
    opts.cloudFrontDomain,
  );
  console.log(`  DNS record created.`);
}
