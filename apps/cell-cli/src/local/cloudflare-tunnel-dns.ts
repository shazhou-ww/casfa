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
  const body = { type: "CNAME", name: hostname, content, ttl: 1 };
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
