import { strict as assert } from "node:assert";
import { test } from "node:test";
import YAML from "yaml";
import { appendTxtValue, replaceExistingRecord } from "./dns-edit";
import { assertZoneFormatting } from "./zone-sort";

test("additional TXT values share one record set after editing", () => {
  const original = "abc: # owner\n- type: TXT\n  value: old\n- type: A\n  value: 1.2.3.4\n";
  const edited = replaceExistingRecord(original, "abc", { type: "TXT", value: "old" }, "owner", {
    type: "TXT",
    value: "first",
    mxPreference: 10,
  });
  const result = appendTxtValue(appendTxtValue(edited, "abc", "second"), "abc", "third");
  assert.deepEqual(YAML.parse(result).abc, [
    { type: "TXT", values: ["first", "second", "third"] },
    { type: "A", value: "1.2.3.4" },
  ]);
  assertZoneFormatting(result);
});

test("adding to an existing TXT set preserves metadata and rejects conflicting TTL", () => {
  const original =
    "abc: # owner\n  ttl: 300\n  type: TXT\n  values:\n  - one\n  - two\n  custom: kept\n";
  const result = appendTxtValue(original, "abc", "three");
  assert.deepEqual(YAML.parse(result).abc, {
    ttl: 300,
    type: "TXT",
    values: ["one", "two", "three"],
    custom: "kept",
  });
  assert.match(result, /# owner/);
  assertZoneFormatting(result);
  assert.throws(() => appendTxtValue(original, "abc", "three", 600), /same TTL/);
});
