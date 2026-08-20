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

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const isIpv4 = (v: string) => IPV4.test(v);

export function isIpv6(v: string): boolean {
  if (!/^[0-9A-Fa-f:.]+$/.test(v) || !v.includes(":")) return false;

  const halves = v.split("::");
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;

  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0] ?? "");
  const tail = groups(halves[1] ?? "");
  const all = [...head, ...tail];
  if (all.some((g) => g === "")) return false;

  const hex = [...all];
  let count = all.length;
  if (hex[hex.length - 1]?.includes(".")) {
    if (!isIpv4(hex.pop()!)) return false;
    count += 1;
  }
  if (hex.some((g) => !/^[0-9A-Fa-f]{1,4}$/.test(g))) return false;

  return compressed ? count < 8 : count === 8;
}

export function isUnroutableIp(v: string): boolean {
  if (isIpv4(v)) {
    const [a = 0, b = 0] = v.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return a >= 224; // multicast + reserved
  }

  const v6 = v.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

const HOSTNAME_LABEL = /^[A-Za-z0-9_]([A-Za-z0-9_-]*[A-Za-z0-9_])?$/;
const TLD = /^(?:xn--[A-Za-z0-9-]+|[A-Za-z]{2,})$/;

export function hostnameError(raw: string, what: string): string | null {
  const v = raw.trim();
  if (!v) return `${what} cannot be empty`;

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v)) {
    return `${what} must be a hostname, not a URL — drop the scheme (e.g. "https://") and any path.`;
  }
  if (v.includes("/"))
    return `${what} cannot contain "/" — enter just the hostname, without a path.`;
  if (/\s/.test(v)) return `${what} cannot contain spaces.`;
  if (v.includes("@")) return `${what} cannot contain "@".`;
  if (v.includes(":")) return `${what} cannot include a port or scheme.`;
  if (v.includes("?") || v.includes("#"))
    return `${what} cannot contain a query string or fragment.`;
  if (v.includes("*")) return `${what} cannot contain a wildcard.`;
  if (isIpv4(v) || isIpv6(v)) {
    return `${what} must be a hostname, not an IP address — use an ${isIpv4(v) ? "A" : "AAAA"} record for an IP.`;
  }

  const host = v.replace(/\.$/, "");
  if (host.length > 253) return `${what} is too long (max 253 characters).`;
  if (host.includes("..")) return `${what} has an empty label (".." in the hostname).`;

  const labels = host.split(".");
  if (labels.length < 2) {
    return `${what} must be a fully qualified domain name, like "example.com".`;
  }
  for (const label of labels) {
    if (label.length > 63)
      return `"${label}" is too long — each part of a hostname is max 63 characters.`;
    if (!HOSTNAME_LABEL.test(label)) {
      return `"${label}" is not a valid hostname part — use letters, numbers, and hyphens (not at the start or end).`;
    }
  }
  if (!TLD.test(labels[labels.length - 1] ?? "")) {
    return `${what} must end in a valid TLD, like ".com".`;
  }

  return null;
}

const TXT_MAX = 2048;

const hasControlChar = (v: string) =>
  [...v].some((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });

export function recordValueError(type: string, raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return "Value must be text.";
  }
  const v = String(raw).trim();
  if (!v) return "Value cannot be empty.";

  switch (type.toUpperCase()) {
    case "A":
      if (isIpv6(v)) return "That is an IPv6 address — use an AAAA record instead.";
      if (!isIpv4(v)) {
        return /^[A-Za-z0-9]/.test(v) && !/^[\d.]+$/.test(v)
          ? "An A record needs an IPv4 address (e.g. 192.0.2.1). To point at a hostname, use CNAME."
          : "Enter a valid IPv4 address, like 192.0.2.1.";
      }
      if (isUnroutableIp(v)) {
        return `${v} is a private or reserved address — it will not resolve for anyone outside that network.`;
      }
      return null;

    case "AAAA":
      if (isIpv4(v)) return "That is an IPv4 address — use an A record instead.";
      if (!isIpv6(v)) {
        return /^[A-Za-z0-9]/.test(v) && !v.includes(":")
          ? "An AAAA record needs an IPv6 address (e.g. 2001:db8::1). To point at a hostname, use CNAME."
          : "Enter a valid IPv6 address, like 2001:db8::1.";
      }
      if (isUnroutableIp(v)) {
        return `${v} is a private or reserved address — it will not resolve for anyone outside that network.`;
      }
      return null;

    case "CNAME":
    case "ALIAS":
      return hostnameError(v, "A CNAME/ALIAS target");

    case "MX":
      return hostnameError(v, "An MX exchange");

    case "TXT":
      if (v.includes("\n") || v.includes("\r")) return "TXT values cannot span multiple lines.";
      if (hasControlChar(v)) return "TXT values cannot contain control characters.";
      if (v.length > TXT_MAX) return `TXT values are limited to ${TXT_MAX} characters.`;
      return null;

    default:
      return null;
  }
}

const stripDot = (v: string) => v.trim().replace(/\.$/, "").toLowerCase();

export interface CollisionRecord {
  type: string;
  value: string;
}

export type CollisionKind = "duplicate" | "cname" | "address";

export interface RecordCollision {
  kind: CollisionKind;
  existing: CollisionRecord[];
}

const isCnameLike = (type: string) => {
  const t = type.toUpperCase();
  return t === "CNAME" || t === "ALIAS";
};

export function flattenYamlRecords(entry: unknown): CollisionRecord[] {
  const records = (Array.isArray(entry) ? entry : [entry]).filter(isObj);
  const out: CollisionRecord[] = [];
  for (const r of records) {
    const type = typeof r.type === "string" ? r.type : "UNKNOWN";
    const src = r.values ?? r.value;
    const values = Array.isArray(src) ? src : src == null ? [] : [src];
    for (const v of values) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out.push({ type, value: String(v) });
      } else if (isObj(v) && (typeof v.exchange === "string" || typeof v.exchange === "number")) {
        out.push({ type, value: String(v.exchange) });
      }
    }
  }
  return out;
}

export function sameRecordTarget(
  a: { type: string; value: string; mxPreference?: number },
  b: { type: string; value: string; mxPreference?: number },
): boolean {
  if (a.type.toUpperCase() !== b.type.toUpperCase()) return false;
  if (stripDot(String(a.value)) !== stripDot(String(b.value))) return false;
  if (a.type.toUpperCase() !== "MX") return true;
  if (a.mxPreference === undefined || b.mxPreference === undefined) return true;
  return Number(a.mxPreference) === Number(b.mxPreference);
}

export function addRecordCollision(
  existing: CollisionRecord[],
  type: string,
  value: string,
): RecordCollision | null {
  if (existing.length === 0) return null;

  const t = type.toUpperCase();
  const trimmed = String(value).trim();
  const v = stripDot(trimmed);

  if (trimmed) {
    const dup = existing.filter(
      (r) => r.type.toUpperCase() === t && stripDot(String(r.value)) === v,
    );
    if (dup.length) return { kind: "duplicate", existing: dup };
  }

  if (isCnameLike(t) || existing.some((r) => isCnameLike(r.type))) {
    return { kind: "cname", existing };
  }

  if (t === "A" || t === "AAAA") {
    const same = existing.filter((r) => r.type.toUpperCase() === t);
    if (same.length) return { kind: "address", existing: same };
  }

  return null;
}

export function collisionBlocksAdd(c: RecordCollision | null | undefined): c is RecordCollision {
  return !!c && c.kind !== "address";
}

function describeExisting(records: CollisionRecord[]): string {
  const first = records[0];
  if (!first) return "an existing record";
  const extra = records.length > 1 ? ` (and ${records.length - 1} more)` : "";
  const article = /^[AEIOU]/i.test(first.type) ? "an" : "a";
  return `${article} ${first.type} record (${first.value})${extra}`;
}

export function formatCollisionMessage(
  collision: RecordCollision,
  opts: { fqdn: string; newType: string },
): string {
  const { fqdn, newType } = opts;
  const t = newType.toUpperCase();
  const shown = describeExisting(collision.existing);

  switch (collision.kind) {
    case "duplicate":
      return `A ${t} record with that value already exists for ${fqdn}. If you meant to change it, overwrite the existing record instead of adding a new one.`;
    case "cname":
      if (isCnameLike(t)) {
        return `${fqdn} already has ${shown}. A CNAME cannot share a name with another record. If you meant to replace it, overwrite the existing record instead.`;
      }
      return `${fqdn} already has ${shown}. Adding a ${t} record here would collide with the CNAME. If you meant to replace it, overwrite the existing record instead.`;
    case "address":
      return `${fqdn} already has ${shown}. Adding another ${t} record will leave both addresses in DNS. If you meant to replace the existing one, overwrite it instead.`;
  }
}

export function selfReferenceError(
  type: string,
  value: unknown,
  subdomain: string,
  domainFile: string,
): string | null {
  const t = type.toUpperCase();
  if (t !== "CNAME" && t !== "ALIAS") return null;
  if (typeof value !== "string") return null;

  const fqdn = `${subdomain.trim().toLowerCase()}.${bareDomain(domainFile)}`;
  return stripDot(value) === stripDot(fqdn)
    ? `This ${t} points at itself (${fqdn}) — pick a different target.`
    : null;
}

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
