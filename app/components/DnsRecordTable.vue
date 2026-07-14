<script setup lang="ts">
import type { DnsMxValue, DnsRecordGroup, DnsValue } from "#shared/types/dns";

const props = defineProps<{
  domain: string;
  groups: DnsRecordGroup[];
  searchQuery?: string;
}>();

interface Row {
  siteUrl: string | null;
  subdomain: string;
  ttl?: number;
  type: string;
  value: DnsValue;
}

const bareDomain = computed(() => props.domain.replace(/\.yaml$/, ""));

const rows = computed<Row[]>(() =>
  props.groups.flatMap((group) =>
    group.records.flatMap((record) =>
      (record.values.length ? record.values : [""]).map((value) => ({
        siteUrl: siteUrlFor(group.subdomain, record.type, value),
        subdomain: group.subdomain,
        ttl: record.ttl,
        type: record.type,
        value,
      })),
    ),
  ),
);

function isMxValue(value: DnsValue): value is DnsMxValue {
  return typeof value === "object" && value !== null;
}

function isVercel(type: string, value: DnsValue) {
  return (
    (type === "CNAME" || type === "ALIAS") &&
    typeof value === "string" &&
    value.includes("cname.vercel-dns.com.")
  );
}

function formatValue(value: DnsValue) {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function displayName(subdomain: string) {
  if (!subdomain || subdomain === "@") return bareDomain.value;
  return `${subdomain}.${bareDomain.value}`;
}

function siteUrlFor(subdomain: string, type: string, value: DnsValue) {
  const validTypes = new Set(["A", "AAAA", "CNAME", "ALIAS"]);
  if (!validTypes.has(type)) return null;

  const nonSiteTargets = [
    "amazonses.com",
    "_acme.deno.dev",
    "acm-validations",
    "custom-email-domain.stripe.com",
    "verify.bing.com",
  ];

  if (
    type === "CNAME" &&
    typeof value === "string" &&
    nonSiteTargets.some((target) => value.includes(target))
  ) {
    return null;
  }

  const prefix = !subdomain || subdomain === "@" ? "" : `${subdomain}.`;
  return `https://${prefix}${bareDomain.value}`;
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-dark">
    <div class="border-b border-border px-4 py-3 text-sm font-medium text-snow">
      {{ rows.length }} {{ rows.length === 1 ? "record" : "records" }}
    </div>

    <div class="overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr class="border-b border-border text-left text-xs font-medium text-muted">
            <th scope="col" class="px-4 py-2.5">Name</th>
            <th scope="col" class="px-4 py-2.5">Type</th>
            <th scope="col" class="px-4 py-2.5">Content</th>
            <th scope="col" class="px-4 py-2.5">TTL</th>
            <th scope="col" class="px-4 py-2.5">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/60">
          <tr
            v-for="(row, index) in rows"
            :key="index"
            class="text-sm transition-colors hover:bg-darkless/60"
          >
            <td class="max-w-64 truncate px-4 py-2.5 text-snow" :title="displayName(row.subdomain)">
              <HighlightedText :text="displayName(row.subdomain)" :query="searchQuery" />
            </td>
            <td class="px-4 py-2.5 font-medium text-snow">
              <HighlightedText :text="row.type" :query="searchQuery" />
            </td>
            <td class="max-w-96 truncate px-4 py-2.5 text-muted" :title="formatValue(row.value)">
              <template v-if="row.type === 'MX' && isMxValue(row.value)">
                <span>Priority: </span>
                <span
                  v-if="row.value.priority !== undefined || row.value.preference !== undefined"
                  class="text-snow"
                >
                  <HighlightedText
                    :text="String(row.value.priority ?? row.value.preference)"
                    :query="searchQuery"
                  />
                </span>
                <span v-else class="text-yellow">Invalid Priority</span>
                <span>, Exchange: </span>
                <span v-if="row.value.exchange" class="text-snow">
                  <HighlightedText :text="row.value.exchange" :query="searchQuery" />
                </span>
                <span v-else class="text-yellow">Invalid Exchange</span>
              </template>

              <span
                v-else-if="isVercel(row.type, row.value)"
                class="inline-flex items-center gap-1.5 text-snow"
              >
                <Icon name="simple-icons:vercel" size="0.875rem" />
                Vercel
              </span>

              <span
                v-else-if="row.value !== ''"
                class="text-snow"
                :class="{ 'font-mono text-xs': row.type === 'TXT' }"
              >
                <HighlightedText :text="formatValue(row.value)" :query="searchQuery" />
              </span>
              <span v-else>No value</span>
            </td>
            <td class="px-4 py-2.5 whitespace-nowrap text-muted">
              {{ row.ttl ?? "Auto" }}
            </td>
            <td class="px-4 py-2.5 text-right">
              <a
                v-if="row.siteUrl"
                :href="row.siteUrl"
                target="_blank"
                rel="noreferrer"
                class="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-primary"
                :title="`Open ${row.siteUrl}`"
              >
                <Icon name="material-symbols:open-in-new" size="0.875rem" />
                Open
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
