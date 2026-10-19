import YAML from "yaml";

// Match hackclub/dns bin/sort-zones: reverse labels only for STRING keys,
// then use case-sensitive natural integer sorting (not locale collation).
function naturalKey(value: unknown): (string | bigint)[] {
  const text =
    typeof value === "string"
      ? value.split(".").reverse().join(".")
      : value === null
        ? "null"
        : typeof value === "boolean"
          ? value
            ? "True"
            : "False"
          : String(value);
  const parts: (string | bigint)[] = (text.normalize("NFD").match(/[0-9]+|[^0-9]+/g) ?? []).map(
    (part) => (/^[0-9]+$/.test(part) ? BigInt(part) : part),
  );
  if (typeof parts[0] === "bigint") parts.unshift("");
  return parts;
}

export function compareZoneKeys(a: unknown, b: unknown): number {
  const left = naturalKey(a);
  const right = naturalKey(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!;
    const y = right[i]!;
    if (x === y) continue;
    if (typeof x !== typeof y) throw new Error("Invalid natural sort tokens");
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

export function zoneKeys(content: string): unknown[] {
  const doc = YAML.parseDocument(content);
  if (doc.errors.length) throw doc.errors[0];
  if (!YAML.isMap(doc.contents)) throw new Error("Zone must contain a YAML mapping");
  return doc.contents.items.map(({ key }) => {
    if (!YAML.isScalar(key)) throw new Error("Zone keys must be scalars");
    return key.value;
  });
}

// Check block-list indentation without reserializing (and changing quotes/comments).
// This guards the emitter's layout, not every ruamel.yaml canonicalization rule.
export function assertZoneFormatting(content: string): void {
  const lineCounter = new YAML.LineCounter();
  const doc = YAML.parseDocument(content, { lineCounter });
  if (doc.errors.length) throw doc.errors[0];
  YAML.visit(doc, {
    Pair(_, { key, value }) {
      if (!YAML.isScalar(key) || !YAML.isSeq(value) || value.flow) return;
      if (!key.range || !value.range) return;
      const keyColumn = lineCounter.linePos(key.range[0]).col;
      const listColumn = lineCounter.linePos(value.range[0]).col;
      if (listColumn !== keyColumn + 2) {
        throw new Error(
          `DNS block list under "${String(key.value)}" must be indented two spaces. No pull request was created.`,
        );
      }
    },
  });
}

export function assertZoneSortOrder(content: string): void {
  const keys = zoneKeys(content);
  for (let i = 1; i < keys.length; i++) {
    if (compareZoneKeys(keys[i - 1], keys[i]) > 0) {
      throw new Error(
        `DNS zone is not sorted: "${String(keys[i])}" must precede "${String(keys[i - 1])}". No pull request was created.`,
      );
    }
  }
}
