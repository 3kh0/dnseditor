import YAML from "yaml";
import { isDomainFile } from "#shared/dns";
import type { DnsMxValue, DnsRecord, DnsRecordGroup, DnsValue } from "#shared/types/dns";

type UnknownRecord = Record<string, unknown>;

export default defineEventHandler(async (event): Promise<DnsRecordGroup[]> => {
  const domain = getRouterParam(event, "domain");

  if (!domain || !isDomainFile(domain)) {
    throw createError({
      statusCode: 404,
      statusMessage: "Unknown domain",
    });
  }

  try {
    const source = await $fetch<string>(
      `https://raw.githubusercontent.com/hackclub/dns/refs/heads/main/${domain}`,
      { responseType: "text" },
    );
    const document = YAML.parse(source);

    if (!isObject(document)) {
      throw new TypeError("The DNS file does not contain a YAML object");
    }

    setResponseHeader(event, "Cache-Control", "public, max-age=60, s-maxage=300");

    return Object.entries(document).map(([subdomain, entry]) => ({
      subdomain,
      records: normalizeRecordList(entry),
    }));
  } catch (error) {
    console.error(`Failed to load ${domain}`, error);
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to load DNS records for ${domain}`,
      cause: error,
    });
  }
});

function normalizeRecordList(entry: unknown): DnsRecord[] {
  const entries = Array.isArray(entry) ? entry : [entry];
  return entries.filter(isObject).map(normalizeRecord);
}

function normalizeRecord(record: UnknownRecord): DnsRecord {
  const source = record.values ?? record.value;
  const values = (Array.isArray(source) ? source : source == null ? [] : [source])
    .map(normalizeValue)
    .filter((value): value is DnsValue => value !== undefined);

  return {
    type: typeof record.type === "string" ? record.type : "UNKNOWN",
    ...(typeof record.ttl === "number" ? { ttl: record.ttl } : {}),
    values,
  };
}

function normalizeValue(value: unknown): DnsValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (isObject(value)) {
    const normalized: DnsMxValue = {};

    for (const [key, item] of Object.entries(value)) {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        normalized[key] = item;
      }
    }

    return normalized;
  }
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
