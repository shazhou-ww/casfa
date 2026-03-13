/**
 * Ensure a CNAME record exists for the given hostname pointing to the tunnel.
 * Used when cloudflared tunnel route dns fails or doesn't create the record.
 */

export interface ZoneInfo {
  id: string;
  name: string;
}

/** Fetch zones (id + name) from Cloudflare API. Returns [] if token missing or request fails. */
export async function fetchCloudflareZonesWithId(
  apiToken: string
): Promise<ZoneInfo[]> {
  const res = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=50", {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    success?: boolean;
    result?: { id: string; name: string }[];
  };
  if (!data.success || !Array.isArray(data.result)) return [];
  return data.result.map((z) => ({ id: z.id, name: z.name }));
}

/** Find the zone that is the longest suffix match for hostname (e.g. sso.casfa.mymbp.shazhou.work -> shazhou.work). */
export function findZoneForHostname(
  zones: ZoneInfo[],
  hostname: string
): ZoneInfo | null {
  const lower = hostname.toLowerCase();
  let best: ZoneInfo | null = null;
  for (const z of zones) {
    const zoneSuffix = "." + z.name.toLowerCase();
    if (
      lower === z.name.toLowerCase() ||
      lower.endsWith(zoneSuffix)
    ) {
      if (!best || z.name.length > best.name.length) best = z;
    }
  }
  return best;
}

/** Create or update CNAME record for hostname -> target (e.g. xxx.cfargotunnel.com). Returns true on success. */
export async function setCnameRecord(
  apiToken: string,
  zoneId: string,
  hostname: string,
  target: string
): Promise<{ ok: boolean; error?: string }> {
  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  if (!listRes.ok) {
    return { ok: false, error: `list: ${listRes.status}` };
  }
  const listData = (await listRes.json()) as {
    success?: boolean;
    result?: { id: string }[];
  };
  const content = target.endsWith(".") ? target : target + ".";
  const body = { type: "CNAME", name: hostname, content, ttl: 1, proxied: true };
  if (listData.success && Array.isArray(listData.result) && listData.result.length > 0) {
    const recordId = listData.result[0]!.id;
    const updateRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    if (!updateRes.ok) {
      const err = (await updateRes.json()) as { errors?: { message: string }[] };
      return { ok: false, error: err.errors?.[0]?.message ?? `update: ${updateRes.status}` };
    }
    return { ok: true };
  }
  const createRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!createRes.ok) {
    const err = (await createRes.json()) as { errors?: { message: string }[] };
    return { ok: false, error: err.errors?.[0]?.message ?? `create: ${createRes.status}` };
  }
  return { ok: true };
}

/**
 * Order an Advanced Certificate for the given hostname via Cloudflare API.
 * Uses POST zones/:zoneId/ssl/certificate_packs/order so the certificate is explicitly allocated
 * (uses one Advanced Certificate quota slot). Returns { ok, error }.
 */
export async function orderAdvancedCertificate(
  apiToken: string,
  zoneId: string,
  hostname: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/ssl/certificate_packs/order`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "advanced",
        hosts: [hostname],
        certificate_authority: "google",
        validation_method: "http",
        validity_days: 90,
      }),
    }
  );
  const data = (await res.json()) as {
    success?: boolean;
    errors?: { message: string }[];
    result?: unknown;
  };
  if (res.ok && data.success) return { ok: true };
  const msg = data.errors?.[0]?.message ?? `HTTP ${res.status}`;
  return { ok: false, error: msg };
}

/** Error messages that indicate the edge certificate is not ready yet (Total TLS pending validation). */
const TLS_PENDING_PATTERNS = [
  /certificate/i,
  /ssl/i,
  /tls/i,
  /cert/i,
  /handshake/i,
  /err_ssl/i,
  /unable to verify/i,
  /certificate has expired/i,
  /self-signed/i,
];

/**
 * Probe https://host to see if the edge certificate is ready (Total TLS).
 * Returns true when the TLS handshake succeeds (any HTTP response); false on timeout.
 * Used after setCnameRecord so cell dev can wait for "pending validation" to complete.
 * The first request may trigger certificate issuance; the cert can appear in Dashboard after that.
 */
export async function waitForEdgeCertificate(
  host: string,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    /** Called each poll (e.g. to log progress). */
    onPoll?: (attempt: number, elapsedMs: number) => void;
    /** If set, first failure error is passed here (for debugging). */
    onFirstError?: (err: unknown) => void;
  }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 120_000; // 2 min
  const pollIntervalMs = options?.pollIntervalMs ?? 5000; // 5 s
  const onPoll = options?.onPoll;
  const onFirstError = options?.onFirstError;
  const url = `https://${host}/`;
  const start = Date.now();
  let attempt = 0;
  let firstErrorLogged = false;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    onPoll?.(attempt, Date.now() - start);
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(t);
      // Any response means TLS handshake succeeded; cert is ready
      return true;
    } catch (e) {
      if (!firstErrorLogged && onFirstError) {
        firstErrorLogged = true;
        onFirstError(e);
      }
      const msg = String((e as Error)?.message ?? e);
      const isTlsError = TLS_PENDING_PATTERNS.some((p) => p.test(msg));
      if (!isTlsError && !msg.includes("abort")) {
        // Could be connection refused (proxy/tunnel down) or DNS not propagated; keep retrying
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}
