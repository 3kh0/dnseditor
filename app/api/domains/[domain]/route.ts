import { isDomainFile } from "@/shared/dns";
import type { DnsRecordGroup } from "@/shared/types/dns";
import {
  DOMAIN_CACHE_MAX_AGE,
  DOMAIN_CACHE_STALE_MAX_AGE,
  getDomainRecords,
} from "@/lib/server/domain-records";
import { httpError, route } from "@/lib/server/http";

export const GET = route(async (ctx): Promise<DnsRecordGroup[]> => {
  const domain = ctx.params.domain;
  if (!domain || !isDomainFile(domain)) {
    throw httpError({ statusCode: 404, message: "Unknown domain" });
  }

  const raw = ctx.query("fresh");
  const fresh = raw !== undefined && raw !== "0" && raw !== "false";

  ctx.headers.set(
    "Cache-Control",
    fresh
      ? "no-store"
      : `public, max-age=${DOMAIN_CACHE_MAX_AGE}, s-maxage=600, stale-while-revalidate=${DOMAIN_CACHE_STALE_MAX_AGE}`,
  );

  try {
    return await getDomainRecords(domain, { fresh });
  } catch (e) {
    console.error(`Failed to load ${domain}`, e);
    throw httpError({ statusCode: 502, message: `Failed to load DNS records for ${domain}` });
  }
});
