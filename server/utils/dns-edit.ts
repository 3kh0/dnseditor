import YAML from "yaml";
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

export interface RecordMatch {
  type: string;
  value: string;
  mxPreference?: number;
}

export interface ReplacementRecord {
  type: string;
  ttl?: number;
  value: string;
  mxPreference: number;
  proxied?: boolean;
}

export function replaceExistingRecord(
  content: string,
  subdomain: string,
  match: RecordMatch,
  contact: string,
  replacement: ReplacementRecord,
) {
  const lines = split(content);
  const top = findTopKeys(lines);
  const idx = top.findIndex((e) => e.key === subdomain);
  if (idx === -1) {
    throw createError({ statusCode: 404, message: `Subdomain "${subdomain}" not found` });
  }

  const keyIdx = top[idx]!.i;
  const nextIdx = top[idx + 1]?.i ?? lines.length;

  let blockEnd = nextIdx;
  while (blockEnd > keyIdx + 1 && (lines[blockEnd - 1] ?? "").trim() === "") blockEnd--;

  const blockText = lines.slice(keyIdx, blockEnd).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYamlBlock(blockText);
  } catch (e) {
    throw createError({
      statusCode: 500,
      message: `Failed to parse subdomain block for "${subdomain}"`,
      cause: e,
    });
  }

  if (!isObj(parsed) || !Object.prototype.hasOwnProperty.call(parsed, subdomain)) {
    throw createError({
      statusCode: 500,
      message: `Could not parse subdomain entry for "${subdomain}"`,
    });
  }

  const entry = parsed[subdomain];
  const updated = mutateEntry(entry, match, replacement);
  const block = serializeSubdomainBlock(subdomain, contact, updated);

  return join([...lines.slice(0, keyIdx), ...block, ...lines.slice(blockEnd)]);
}

export function removeExistingRecord(content: string, subdomain: string, match: RecordMatch) {
  const lines = split(content);
  const top = findTopKeys(lines);
  const idx = top.findIndex((e) => e.key === subdomain);
  if (idx === -1) {
    throw createError({ statusCode: 404, message: `Subdomain "${subdomain}" not found` });
  }

  const keyIdx = top[idx]!.i;
  const nextIdx = top[idx + 1]?.i ?? lines.length;

  let blockEnd = nextIdx;
  while (blockEnd > keyIdx + 1 && (lines[blockEnd - 1] ?? "").trim() === "") blockEnd--;

  const blockText = lines.slice(keyIdx, blockEnd).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYamlBlock(blockText);
  } catch (e) {
    throw createError({
      statusCode: 500,
      message: `Failed to parse subdomain block for "${subdomain}"`,
      cause: e,
    });
  }

  if (!isObj(parsed) || !Object.prototype.hasOwnProperty.call(parsed, subdomain)) {
    throw createError({
      statusCode: 500,
      message: `Could not parse subdomain entry for "${subdomain}"`,
    });
  }

  const entry = parsed[subdomain];
  const remaining = removeMatchingItem(entry, match);

  if (remaining === null) {
    return join([...lines.slice(0, keyIdx), ...lines.slice(nextIdx)]);
  }

  const contactMatch = (lines[keyIdx] ?? "").match(/#\s*(.*)$/);
  const contact = contactMatch?.[1]?.trim() ?? "";
  const block = serializeSubdomainBlock(subdomain, contact, remaining);

  return join([...lines.slice(0, keyIdx), ...block, ...lines.slice(blockEnd)]);
}

function removeMatchingItem(entry: unknown, match: RecordMatch): unknown {
  const matchType = match.type.toUpperCase();
  const wasList = Array.isArray(entry);
  const list: unknown[] = wasList ? [...entry] : [entry];
  let found = false;
  const out: unknown[] = [];

  for (const item of list) {
    if (!isObj(item)) {
      out.push(item);
      continue;
    }

    const itemType = typeof item.type === "string" ? item.type.toUpperCase() : "";
    if (itemType !== matchType) {
      out.push(item);
      continue;
    }

    if (Array.isArray(item.values)) {
      const valueIdx = item.values.findIndex((v) => valueMatches(v, match));
      if (valueIdx === -1) {
        out.push(item);
        continue;
      }
      found = true;

      const remaining = item.values.filter((_, i) => i !== valueIdx);
      if (remaining.length > 0) {
        out.push(rebuildRecordKeepingValues(item, remaining));
      }
      continue;
    }

    if (valueMatches(item.value, match)) {
      found = true;
      continue;
    }

    out.push(item);
  }

  if (!found) {
    throw createError({
      statusCode: 404,
      message: `No matching ${matchType} record with that value was found under this subdomain`,
    });
  }

  if (out.length === 0) return null;
  if (!wasList && out.length === 1) return out[0];
  return out;
}

const parseYamlBlock = (text: string): unknown => YAML.parse(text);

function mutateEntry(entry: unknown, match: RecordMatch, replacement: ReplacementRecord): unknown {
  const matchType = match.type.toUpperCase();
  const wasList = Array.isArray(entry);
  const list: unknown[] = wasList ? [...entry] : [entry];
  let found = false;
  const out: unknown[] = [];

  for (const item of list) {
    if (!isObj(item)) {
      out.push(item);
      continue;
    }

    const itemType = typeof item.type === "string" ? item.type.toUpperCase() : "";
    if (itemType !== matchType) {
      out.push(item);
      continue;
    }

    if (Array.isArray(item.values)) {
      const valueIdx = item.values.findIndex((v) => valueMatches(v, match));
      if (valueIdx === -1) {
        out.push(item);
        continue;
      }
      found = true;

      if (replacement.type.toUpperCase() === matchType) {
        const nextValues = item.values.map((v, i) =>
          i === valueIdx ? replacementValue(replacement) : v,
        );
        out.push(rebuildRecordKeepingValues(applyMeta(item, replacement), nextValues));
        continue;
      }

      const remaining = item.values.filter((_, i) => i !== valueIdx);
      if (remaining.length > 0) {
        out.push(rebuildRecordKeepingValues(item, remaining));
      }
      out.push(buildReplacementObject(replacement));
      continue;
    }

    if (valueMatches(item.value, match)) {
      found = true;
      out.push(buildReplacementObject(replacement));
      continue;
    }

    out.push(item);
  }

  if (!found) {
    throw createError({
      statusCode: 404,
      message: `No matching ${matchType} record with that value was found under this subdomain`,
    });
  }

  if (!wasList && out.length === 1) return out[0];
  return out;
}

function rebuildRecordKeepingValues(
  original: Record<string, unknown>,
  values: unknown[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...original };
  if (values.length === 1 && original.type !== "MX" && !isObj(values[0])) {
    delete next.values;
    next.value = values[0];
  } else {
    next.values = values;
    delete next.value;
  }
  return next;
}

function replacementValue(r: ReplacementRecord): unknown {
  if (r.type === "MX") return { exchange: r.value, preference: r.mxPreference };
  return r.value;
}

function applyMeta(
  original: Record<string, unknown>,
  r: ReplacementRecord,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...original, type: r.type };
  if (r.proxied) {
    next.octodns = { cloudflare: { proxied: true } };
    delete next.ttl;
  } else {
    if (isObj(next.octodns)) {
      const oct = { ...next.octodns };
      if (isObj(oct.cloudflare)) {
        const cf = { ...oct.cloudflare };
        delete cf.proxied;
        if (Object.keys(cf).length === 0) delete oct.cloudflare;
        else oct.cloudflare = cf;
      }
      if (Object.keys(oct).length === 0) delete next.octodns;
      else next.octodns = oct;
    }
    if (r.ttl !== undefined) next.ttl = r.ttl;
    else delete next.ttl;
  }
  return next;
}

function buildReplacementObject(r: ReplacementRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (r.proxied) {
    out.octodns = { cloudflare: { proxied: true } };
  } else if (r.ttl !== undefined) {
    out.ttl = r.ttl;
  }
  out.type = r.type;
  if (r.type === "MX") {
    out.values = [{ exchange: r.value, preference: r.mxPreference }];
  } else {
    out.value = r.value;
  }
  return out;
}

function valueMatches(raw: unknown, match: RecordMatch): boolean {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return normalizeCompare(String(raw)) === normalizeCompare(match.value);
  }
  if (!isObj(raw)) return false;

  const exchange = raw.exchange;
  if (typeof exchange !== "string") return false;
  if (normalizeCompare(exchange) !== normalizeCompare(match.value)) return false;

  if (match.mxPreference === undefined) return true;
  const pref = Number(raw.preference ?? raw.priority);
  return Number.isFinite(pref) && pref === match.mxPreference;
}

const normalizeCompare = (v: string) => v.trim().replace(/\.$/, "").toLowerCase();

function serializeSubdomainBlock(subdomain: string, contact: string, entry: unknown): string[] {
  const header = `${formatYamlKey(subdomain)}: # ${contact}`;
  const records = (Array.isArray(entry) ? entry : [entry]).filter(isObj);
  return [header, ...records.flatMap((rec) => serializeRecordObject(rec))];
}

function serializeRecordObject(rec: Record<string, unknown>): string[] {
  const type = typeof rec.type === "string" ? rec.type : "UNKNOWN";
  const proxied = isProxied(rec);
  const ttl = !proxied && typeof rec.ttl === "number" ? rec.ttl : undefined;

  if (Array.isArray(rec.values) && rec.values.length > 0) {
    const head = recordHead({ type, ttl, proxied });
    if (type === "MX") {
      return [...head, `  values:`, ...rec.values.flatMap((v) => serializeMxValue(v))];
    }
    return [...head, `  values:`, ...rec.values.map((v) => `  - ${formatScalar(type, v)}`)];
  }

  const value = rec.value;
  if (type === "MX" && isObj(value)) {
    const exchange = String(value.exchange ?? "");
    const pref = Number(value.preference ?? value.priority ?? 10);
    return formatRecordLines({
      type,
      ttl,
      value: exchange,
      mxPreference: pref,
      proxied,
    });
  }

  return formatRecordLines({
    type,
    ttl,
    value: value === undefined || value === null ? "" : String(value),
    mxPreference: 10,
    proxied,
  });
}

function recordHead(input: { type: string; ttl?: number; proxied?: boolean }): string[] {
  const head: string[] = input.proxied
    ? ["- octodns:", "    cloudflare:", "      proxied: true"]
    : [];
  if (input.ttl !== undefined) head.push(`- ttl: ${input.ttl}`, `  type: ${input.type}`);
  else if (input.proxied) head.push(`  type: ${input.type}`);
  else head.push(`- type: ${input.type}`);
  return head;
}

function serializeMxValue(v: unknown): string[] {
  if (!isObj(v)) return [`  - exchange: ${String(v)}`, `    preference: 10`];
  const exchange = String(v.exchange ?? "");
  const pref = Number(v.preference ?? v.priority ?? 10);
  return [`  - exchange: ${exchange}`, `    preference: ${pref}`];
}

function formatScalar(type: string, v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  if (type === "TXT" && needsYamlQuotes(s)) return JSON.stringify(s);
  return s;
}

function isProxied(rec: Record<string, unknown>): boolean {
  const oct = rec.octodns;
  if (!isObj(oct)) return false;
  const cf = oct.cloudflare;
  if (!isObj(cf)) return false;
  return cf.proxied === true;
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
