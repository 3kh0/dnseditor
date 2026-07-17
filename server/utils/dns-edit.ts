import { hasContact, isObj } from "#shared/dns";

export { hasContact as hasContactInfo, isObj as isPlainObject };

export function normalizeRecordValue(type: string, raw: unknown, mxPref: number) {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    throw createError({ statusCode: 400, message: "Record value must be a string" });
  }

  let v = String(raw).trim();
  if (!v) throw createError({ statusCode: 400, message: "Record value cannot be empty" });

  if (type === "MX" && (!Number.isFinite(mxPref) || mxPref < 0)) {
    throw createError({ statusCode: 400, message: "MX preference must be a non-negative number" });
  }

  if ((type === "CNAME" || type === "ALIAS" || type === "MX") && !v.endsWith(".")) v = `${v}.`;
  return v;
}

export function parseOptionalTtl(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const ttl = Number(raw);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw createError({ statusCode: 400, message: "TTL must be a positive number when set" });
  }
  return ttl;
}

export function formatRecordLines(input: {
  type: string;
  ttl?: number;
  value: string;
  mxPreference: number;
  /** When true, emit octodns cloudflare proxied: true (orange cloud). */
  proxied?: boolean;
}) {
  // Cloudflare auto-TTL when proxied — omit custom ttl in that case.
  const ttl = input.proxied ? undefined : input.ttl;
  const head: string[] = input.proxied
    ? ["- octodns:", "    cloudflare:", "      proxied: true"]
    : [];

  if (ttl !== undefined) head.push(`- ttl: ${ttl}`, `  type: ${input.type}`);
  else if (input.proxied) head.push(`  type: ${input.type}`);
  else head.push(`- type: ${input.type}`);

  if (input.type === "MX") {
    return [
      ...head,
      `  values:`,
      `  - exchange: ${input.value}`,
      `    preference: ${input.mxPreference}`,
    ];
  }

  const value =
    input.type === "TXT" && needsYamlQuotes(input.value)
      ? JSON.stringify(input.value)
      : input.value;

  return [...head, `  value: ${value}`];
}

const needsYamlQuotes = (v: string) =>
  /[:#{}[\],&*!|>'"%@`]/.test(v) || v.includes(" ") || v === "";

export function formatYamlKey(key: string) {
  if (key === "") return "''";
  if (/^\d/.test(key) || /[:#{}[\],&*!|>'"%@`\s]/.test(key)) return `'${key.replace(/'/g, "''")}'`;
  return key;
}

export function insertNewSubdomain(
  content: string,
  existingKeys: string[],
  subdomain: string,
  contact: string,
  recordLines: string[],
) {
  const lines = split(content);
  const top = findTopKeys(lines);
  const nextKey = [...existingKeys].sort(cmpKeys).find((k) => cmpKeys(k, subdomain) > 0);
  const block = [`${formatYamlKey(subdomain)}: # ${contact}`, ...recordLines];

  if (!nextKey) {
    const end = [...lines];
    while (end.length && last(end).trim() === "") end.pop();
    return join([...end, ...block]);
  }

  const next = top.find((e) => e.key === nextKey);
  if (!next) throw new Error(`Could not locate insertion point before key "${nextKey}"`);
  return join([...lines.slice(0, next.i), ...block, ...lines.slice(next.i)]);
}

export function appendToExistingSubdomain(
  content: string,
  subdomain: string,
  recordLines: string[],
) {
  const lines = split(content);
  const top = findTopKeys(lines);
  const idx = top.findIndex((e) => e.key === subdomain);
  if (idx === -1) throw new Error(`Subdomain "${subdomain}" not found in file for append`);

  const entry = top[idx]!;
  const end = top[idx + 1]?.i ?? lines.length;
  let at = end;
  while (at > entry.i + 1 && (lines[at - 1] ?? "").trim() === "") at--;
  return join([...lines.slice(0, at), ...recordLines, ...lines.slice(at)]);
}

const last = (xs: string[]) => xs[xs.length - 1] ?? "";
const split = (s: string) => s.split(/\r?\n/);
const join = (xs: string[]) => {
  const body = xs.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
};

interface TopKey {
  key: string;
  i: number;
}

function findTopKeys(lines: string[]): TopKey[] {
  const keys: TopKey[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line[0] === " " || line[0] === "\t" || line.trimStart().startsWith("#")) continue;
    if (line.trimStart().startsWith("-")) continue;

    const m = line.match(/^('[^']*'|"[^"]*"|[^:#\s][^:#]*?)\s*:/);
    const raw = m?.[1];
    if (!raw) continue;
    keys.push({ key: unquote(raw.trim()), i });
  }
  return keys;
}

const unquote = (raw: string) =>
  (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))
    ? raw.slice(1, -1)
    : raw;

const sortKey = (k: string) => (k ? k.split(".").reverse().join(".") : "");
const cmpKeys = (a: string, b: string) =>
  sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true, sensitivity: "base" });
