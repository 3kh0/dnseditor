export const DOMAIN_FILES = [
  "aisafety.dance.yaml",
  "bank.engineering.yaml",
  "bulckcah.com.yaml",
  "cpu.land.yaml",
  "dino.icu.yaml",
  "dinosaurbbq.org.yaml",
  "hack.af.yaml",
  "hack.club.yaml",
  "hackclub.app.yaml",
  "hackclub.com.yaml",
  "hackclub.community.yaml",
  "hackclub.io.yaml",
  "hackclub.org.yaml",
  "hackedu.us.yaml",
  "hackfoundation.org.yaml",
  "nonprofit.new.yaml",
] as const;

export const DEFAULT_DOMAIN = "hackclub.com.yaml";

export type DomainFile = (typeof DOMAIN_FILES)[number];

export const isDomainFile = (v: string): v is DomainFile =>
  (DOMAIN_FILES as readonly string[]).includes(v);

export const bareDomain = (d: string) => d.replace(/\.yaml$/, "");

export const isSubdomain = (v: string) => /^[A-Za-z0-9_]([A-Za-z0-9._-]*[A-Za-z0-9_])?$/.test(v);

export const hasContact = (v: string) =>
  /\b[UW][A-Z0-9]{8,12}\b/.test(v) || /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/.test(v);

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const fmtDnsValue = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));

export type CnameProvider = "vercel" | "coolify-a" | "coolify-b" | "orchard";

export const CNAME_PROVIDER_LABELS: Record<CnameProvider, string> = {
  vercel: "Vercel",
  "coolify-a": "Coolify A",
  "coolify-b": "Coolify B",
  orchard: "Orchard",
};

export function detectCnameProvider(type: string, value: unknown): CnameProvider | null {
  if ((type !== "CNAME" && type !== "ALIAS") || typeof value !== "string") return null;
  const v = value.trim().replace(/\.$/, "").toLowerCase();
  if (!v) return null;

  if (v.includes("vercel-dns")) return "vercel";

  if (v === "a.ingress.tier2.infra.hackclub.com") return "orchard";

  if (
    v === "b.selfhosted.hackclub.com" ||
    /^b(\.[a-z0-9-]+)*\.selfhosted\.hackclub\.com$/.test(v)
  ) {
    return "coolify-b";
  }
  if (
    v === "a.selfhosted.hackclub.com" ||
    /^a(\.[a-z0-9-]+)*\.selfhosted\.hackclub\.com$/.test(v)
  ) {
    return "coolify-a";
  }

  return null;
}

export const CF_PROXY_DOMAINS = new Set(["hackclub.com.yaml"]);

/** Record types Cloudflare can orange-cloud proxy. */
export const CF_PROXY_TYPES = new Set(["A", "AAAA", "CNAME"]);

export const supportsCfProxy = (domain: string, type?: string) =>
  CF_PROXY_DOMAINS.has(domain) && (type === undefined || CF_PROXY_TYPES.has(type));
