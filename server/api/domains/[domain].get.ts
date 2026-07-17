import YAML from "yaml";
import { isDomainFile, isObj } from "#shared/dns";
import type { DnsMxValue, DnsRecord, DnsRecordGroup, DnsValue } from "#shared/types/dns";

export default defineEventHandler(async (event): Promise<DnsRecordGroup[]> => {
  const domain = getRouterParam(event, "domain");
  if (!domain || !isDomainFile(domain)) {
    throw createError({ statusCode: 404, statusMessage: "Unknown domain" });
  }

  try {
    const source = await $fetch<string>(
      `https://raw.githubusercontent.com/hackclub/dns/refs/heads/main/${domain}`,
      { responseType: "text" },
    );
    const doc = YAML.parse(source);
    if (!isObj(doc)) throw new TypeError("The DNS file does not contain a YAML object");

    setResponseHeader(event, "Cache-Control", "public, max-age=60, s-maxage=300");
    return Object.entries(doc).map(([subdomain, entry]) => ({
      subdomain,
      records: normalizeList(entry),
    }));
  } catch (e) {
    console.error(`Failed to load ${domain}`, e);
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to load DNS records for ${domain}`,
      cause: e,
    });
  }
});

const normalizeList = (entry: unknown): DnsRecord[] =>
  (Array.isArray(entry) ? entry : [entry]).filter(isObj).map(normalizeRecord);

function normalizeRecord(r: Record<string, unknown>): DnsRecord {
  const src = r.values ?? r.value;
  const values = (Array.isArray(src) ? src : src == null ? [] : [src])
    .map(normalizeValue)
    .filter((v): v is DnsValue => v !== undefined);

  const proxied = isProxied(r);

  return {
    type: typeof r.type === "string" ? r.type : "UNKNOWN",
    ...(typeof r.ttl === "number" ? { ttl: r.ttl } : {}),
    ...(proxied ? { proxied: true } : {}),
    values,
  };
}

function isProxied(r: Record<string, unknown>): boolean {
  const oct = r.octodns;
  if (!isObj(oct)) return false;
  const cf = oct.cloudflare;
  if (!isObj(cf)) return false;
  return cf.proxied === true;
}

function normalizeValue(v: unknown): DnsValue | undefined {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (!isObj(v)) return undefined;

  const out: DnsMxValue = {};
  for (const [k, item] of Object.entries(v)) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      out[k] = item;
    }
  }
  return out;
}
