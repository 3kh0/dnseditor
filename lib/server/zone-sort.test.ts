import { strict as assert } from "node:assert";
import { test } from "node:test";
import { insertNewSubdomain } from "./dns-edit";
import { assertZoneSortOrder, compareZoneKeys, zoneKeys } from "./zone-sort";

const record = ["- type: CNAME", "  value: example.com."];
const zone = (keys: string[]) =>
  keys.map((key) => `${key}: # existing contact\n  type: CNAME\n  value: example.com.\n`).join("");

test("PR #3866: insert before numeric YAML 44.74 without reformatting existing blocks", () => {
  const before = zone(['""', '"3am"', "44.74", "67", '"555"']);
  const after = insertNewSubdomain(before, "8-pin-grant", "rudy@hackclub.com", record);
  const block = "'8-pin-grant': # rudy@hackclub.com\n" + record.join("\n") + "\n";
  assert.equal(after, before.replace("44.74:", block + "44.74:"));
  assert.deepEqual(zoneKeys(after), ["", "3am", "8-pin-grant", 44.74, 67, "555"]);
  assertZoneSortOrder(after);
});

test("numeric scalars and quoted dotted strings have different sort keys", () => {
  assert.equal(compareZoneKeys(44.74, "50"), -1);
  assert.equal(compareZoneKeys("44.74", "50"), 1);
});

test("natural sorting is case-sensitive and not locale-dependent", () => {
  const keys = ["z", "a10", "a2", "_acme-challenge", "A", "a", "2", "10", ""];
  assert.deepEqual(keys.sort(compareZoneKeys), [
    "",
    "2",
    "10",
    "A",
    "_acme-challenge",
    "a",
    "a2",
    "a10",
    "z",
  ]);
});

test("nested labels sort beneath their parent with natural numeric order", () => {
  const before = zone(["foo", "a2.foo", "a10.foo", "z"]);
  const after = insertNewSubdomain(before, "a3.foo", "a@hackclub.com", record);
  assert.deepEqual(zoneKeys(after), ["foo", "a2.foo", "a3.foo", "a10.foo", "z"]);
  assertZoneSortOrder(after);
});

test("batch insertions preserve order even when submitted in reverse order", () => {
  let content = zone(['""', "44.74", "z"]);
  for (const key of ["a10", "8-pin-grant", "a2", "a1"]) {
    content = insertNewSubdomain(content, key, "a@hackclub.com", record);
  }
  assert.deepEqual(zoneKeys(content), ["", "8-pin-grant", 44.74, "a1", "a2", "a10", "z"]);
  assertZoneSortOrder(content);
});

test("pre-submit guard rejects unsorted, malformed, and non-mapping zones", () => {
  assert.throws(
    () => assertZoneSortOrder(zone(["44.74", "'8-pin-grant'"])),
    /No pull request was created/,
  );
  assert.throws(() => assertZoneSortOrder("a: ["));
  assert.throws(() => assertZoneSortOrder("- a\n"), /mapping/);
});

test("null and quoted null keys remain distinct for sorting", () => {
  assertZoneSortOrder(zone(["null", "'null'"]));
  assert.deepEqual(zoneKeys(zone(["null", "'null'"])), [null, "null"]);
});
