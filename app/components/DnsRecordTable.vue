<script setup lang="ts">
import { bareDomain, fmtDnsValue } from "#shared/dns";
import type { DnsMxValue, DnsRecordGroup, DnsValue } from "#shared/types/dns";

const props = defineProps<{
  domain: string;
  groups: DnsRecordGroup[];
  searchQuery?: string;
}>();

const emit = defineEmits<{
  edit: [payload: EditPayload];
}>();

export interface EditPayload {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference?: number;
  proxied?: boolean;
}

interface Row {
  siteUrl: string | null;
  subdomain: string;
  ttl?: number;
  type: string;
  value: DnsValue;
  proxied?: boolean;
}

const bare = computed(() => bareDomain(props.domain));

const rows = computed<Row[]>(() =>
  props.groups.flatMap((g) =>
    g.records.flatMap((r) =>
      (r.values.length ? r.values : [""]).map((value) => ({
        siteUrl: siteUrl(g.subdomain, r.type, value),
        subdomain: g.subdomain,
        ttl: r.ttl,
        type: r.type,
        value,
        proxied: r.proxied,
      })),
    ),
  ),
);

const isMx = (v: DnsValue): v is DnsMxValue => typeof v === "object" && v !== null;

const isVercel = (type: string, v: DnsValue) =>
  (type === "CNAME" || type === "ALIAS") &&
  typeof v === "string" &&
  v.includes("cname.vercel-dns.com.");

const displayName = (sub: string) => (!sub || sub === "@" ? bare.value : `${sub}.${bare.value}`);

const SKIP = [
  "amazonses.com",
  "_acme.deno.dev",
  "acm-validations",
  "custom-email-domain.stripe.com",
  "verify.bing.com",
];

function siteUrl(sub: string, type: string, value: DnsValue) {
  if (!new Set(["A", "AAAA", "CNAME", "ALIAS"]).has(type)) return null;
  if (type === "CNAME" && typeof value === "string" && SKIP.some((t) => value.includes(t))) {
    return null;
  }
  const prefix = !sub || sub === "@" ? "" : `${sub}.`;
  return `https://${prefix}${bare.value}`;
}

function onEdit(row: Row) {
  if (row.type === "MX" && isMx(row.value)) {
    emit("edit", {
      subdomain: row.subdomain,
      type: row.type,
      value: row.value.exchange ? String(row.value.exchange) : "",
      ttl: row.ttl,
      mxPreference: Number(row.value.preference ?? row.value.priority ?? 10),
      proxied: row.proxied,
    });
    return;
  }

  emit("edit", {
    subdomain: row.subdomain,
    type: row.type,
    value: row.value === "" ? "" : fmtDnsValue(row.value),
    ttl: row.ttl,
    proxied: row.proxied,
  });
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
            v-for="(row, i) in rows"
            :key="i"
            class="text-sm transition-colors hover:bg-darkless/60"
          >
            <td class="max-w-64 truncate px-4 py-2.5 text-snow" :title="displayName(row.subdomain)">
              <HighlightedText :text="displayName(row.subdomain)" :query="searchQuery" />
            </td>
            <td class="px-4 py-2.5 font-medium text-snow">
              <HighlightedText :text="row.type" :query="searchQuery" />
            </td>
            <td class="max-w-96 truncate px-4 py-2.5 text-muted" :title="fmtDnsValue(row.value)">
              <template v-if="row.type === 'MX' && isMx(row.value)">
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
                <HighlightedText :text="fmtDnsValue(row.value)" :query="searchQuery" />
              </span>
              <span v-else>No value</span>
            </td>
            <td class="px-4 py-2.5 whitespace-nowrap text-muted">{{ row.ttl ?? "Auto" }}</td>
            <td class="px-4 py-2.5 text-right">
              <div class="inline-flex items-center justify-end gap-2">
                <button
                  type="button"
                  class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted transition-colors hover:text-primary"
                  title="Edit this record"
                  @click="onEdit(row)"
                >
                  <Icon name="material-symbols:edit-outline" size="0.875rem" />
                  Edit
                </button>
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
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
