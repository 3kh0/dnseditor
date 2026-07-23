import YAML from "yaml";
import { isObj } from "#shared/dns";
import type { DnsMxValue, DnsRecord, DnsRecordGroup, DnsValue } from "#shared/types/dns";

export const DOMAIN_CACHE_MAX_AGE = 60;
export const DOMAIN_CACHE_STALE_MAX_AGE = 3600;

export const getDomainRecords = defineCachedFunction(
  async (domain: string): Promise<DnsRecordGroup[]> => {
    const source = await $fetch<string>(
      `https://raw.githubusercontent.com/hackclub/dns/refs/heads/main/${domain}`,
      { responseType: "text" },
    );
    const parsed = YAML.parseDocument(source);
    const doc = parsed.toJS();
    if (!isObj(doc)) throw new TypeError("The DNS file does not contain a YAML object");

    const contacts = contactsBySubdomain(parsed);

    return Object.entries(doc).map(([subdomain, entry]) => ({
      subdomain,
      records: normalizeList(entry),
      ...(contacts.get(subdomain) ? { contact: contacts.get(subdomain) } : {}),
    }));
  },
  {
    name: "domain-records",
    maxAge: DOMAIN_CACHE_MAX_AGE,
    swr: true,
    staleMaxAge: DOMAIN_CACHE_STALE_MAX_AGE,
    getKey: (domain) => domain,
  },
);

function contactsBySubdomain(doc: YAML.Document): Map<string, string> {
  const contacts = new Map<string, string>();
  const contents = doc.contents;
  if (!YAML.isMap(contents)) return contacts;

  for (const pair of contents.items) {
    const key = YAML.isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const value = pair.value;
    const raw =
      (YAML.isNode(value) ? value.commentBefore : undefined) ??
      (YAML.isScalar(pair.key) ? pair.key.comment : undefined) ??
      (YAML.isNode(value) ? value.comment : undefined);
    const contact = raw?.split("\n")[0]?.trim();
    if (contact) contacts.set(key, contact);
  }
  return contacts;
}

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
