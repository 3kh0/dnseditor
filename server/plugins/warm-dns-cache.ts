import { DEFAULT_DOMAIN } from "#shared/dns";
import { getDomainRecords } from "../utils/domain-records";

export default defineNitroPlugin(() => {
  void getDomainRecords(DEFAULT_DOMAIN).catch((e) => {
    console.warn(`[warm-dns-cache] failed to warm ${DEFAULT_DOMAIN}`, e);
  });
});
