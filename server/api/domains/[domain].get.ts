import { isDomainFile } from "#shared/dns";
import type { DnsRecordGroup } from "#shared/types/dns";
import {
  DOMAIN_CACHE_MAX_AGE,
  DOMAIN_CACHE_STALE_MAX_AGE,
  getDomainRecords,
} from "../../utils/domain-records";

export default defineEventHandler(async (event): Promise<DnsRecordGroup[]> => {
  const domain = getRouterParam(event, "domain");
  if (!domain || !isDomainFile(domain)) {
    throw createError({ statusCode: 404, statusMessage: "Unknown domain" });
  }

  setResponseHeader(
    event,
    "Cache-Control",
    `public, max-age=${DOMAIN_CACHE_MAX_AGE}, s-maxage=600, stale-while-revalidate=${DOMAIN_CACHE_STALE_MAX_AGE}`,
  );

  try {
    return await getDomainRecords(domain);
  } catch (e) {
    console.error(`Failed to load ${domain}`, e);
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to load DNS records for ${domain}`,
      cause: e,
    });
  }
});
