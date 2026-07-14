<script setup lang="ts">
import type { DnsMxValue, DnsRecord, DnsValue } from "#shared/types/dns";

defineProps<{
  records: DnsRecord[];
  searchQuery?: string;
}>();

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
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-border/10">
    <table class="w-full">
      <thead>
        <tr class="bg-primary/10">
          <th scope="col" class="px-6 py-3 text-left text-sm font-semibold">Type</th>
          <th scope="col" class="px-6 py-3 text-left text-sm font-semibold">Content</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border/10">
        <tr
          v-for="(record, recordIndex) in records"
          :key="`${record.type}-${recordIndex}`"
          class="group/row hover:bg-darkless/80"
        >
          <td class="px-6 py-4 text-sm font-medium">
            <HighlightedText :text="record.type" :query="searchQuery" />
          </td>
          <td class="px-6 py-4 text-sm">
            <ul v-if="record.values.length" class="space-y-2">
              <li
                v-for="(value, valueIndex) in record.values"
                :key="valueIndex"
                class="group-hover/row:text-snow"
                :class="{ 'font-mono': record.type === 'TXT' }"
              >
                <template v-if="record.type === 'MX' && isMxValue(value)">
                  <span class="text-muted">Priority: </span>
                  <HighlightedText
                    v-if="value.priority !== undefined || value.preference !== undefined"
                    :text="String(value.priority ?? value.preference)"
                    :query="searchQuery"
                  />
                  <span v-else class="text-yellow">Invalid Priority</span>
                  <span class="text-muted">, Exchange: </span>
                  <HighlightedText
                    v-if="value.exchange"
                    :text="value.exchange"
                    :query="searchQuery"
                  />
                  <span v-else class="text-yellow">Invalid Exchange</span>
                </template>

                <span v-else-if="isVercel(record.type, value)" class="flex items-center gap-2">
                  <Icon name="simple-icons:vercel" size="1rem" />
                  Vercel
                </span>

                <HighlightedText v-else :text="formatValue(value)" :query="searchQuery" />
              </li>
            </ul>
            <span v-else class="text-muted">No value</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
