<template>
  <div class="overflow-x-auto rounded-lg border border-border/10">
    <table class="w-full">
      <thead>
        <tr class="bg-primary/10">
          <th class="px-6 py-3 text-left text-sm font-semibold">Type</th>
          <th class="px-6 py-3 text-left text-sm font-semibold">Value(s)</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border/10">
        <tr
          v-for="(record, idx) in records"
          :key="idx"
          class="group/row hover:bg-darkless/80"
        >
          <td class="px-6 py-4 text-sm font-medium">
            <span v-html="highlightMatch(record.type)"></span>
          </td>
          <td class="px-6 py-4 text-sm">
            <div v-if="Array.isArray(record.values)">
              <ul class="space-y-2">
                <li
                  v-for="(value, valueIdx) in record.values"
                  :key="valueIdx"
                  class="group-hover/row:text-snow"
                >
                  <template v-if="record.type === 'MX'">
                    <span class="text-muted">Priority:</span>
                    <span
                      v-if="
                        value && ('priority' in value || 'preference' in value)
                      "
                      v-html="
                        highlightMatch(
                          (value.priority || value.preference).toString()
                        )
                      "
                    ></span>
                    <span v-else class="text-yellow">Invalid Priority</span>,
                    <span class="text-muted">Exchange:</span>
                    <span
                      v-if="value && 'exchange' in value"
                      v-html="highlightMatch(value.exchange)"
                    ></span>
                    <span v-else class="text-yellow">Invalid Exchange</span>
                  </template>
                  <template v-else-if="record.type === 'TXT'">
                    <span
                      class="font-mono text-sm"
                      v-html="highlightMatch(value)"
                    ></span>
                  </template>
                  <template v-else>
                    <span v-html="highlightMatch(value.toString())"></span>
                  </template>
                </li>
              </ul>
            </div>
            <div v-else>
              <template v-if="record.type === 'MX' && isMXRecord(record.value)">
                <span class="text-muted">Priority: </span>
                <span
                  v-html="
                    highlightMatch(
                      (
                        record.value.priority || record.value.preference
                      ).toString()
                    )
                  "
                ></span
                >,
                <span class="text-muted">Exchange: </span>
                <span v-html="highlightMatch(record.value.exchange)"></span>
              </template>
              <template
                v-else-if="
                  (record.type === 'CNAME' || record.type === 'ALIAS') &&
                  isVercel(record.values)
                "
              >
                <span class="flex items-center gap-2">
                  <Icon name="simple-icons:vercel" size="1rem" />
                  <span class=""> Vercel</span>
                </span>
              </template>

              <template v-else>
                <span v-html="highlightMatch(record.values.toString())"></span>
              </template>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
const props = defineProps({
  records: {
    type: Array,
    required: true,
  },
  searchQuery: {
    type: String,
    default: "",
  },
});

const highlightMatch = (text) => {
  if (!props.searchQuery) return text;
  const regex = new RegExp(`(${props.searchQuery})`, "gi");
  return text.replace(
    regex,
    '<span class="bg-primary/20 text-primary">$1</span>'
  );
};

const isVercel = (value) => {
  return (
    value &&
    typeof value === "string" &&
    value.includes("cname.vercel-dns.com.")
  );
};

const isMXRecord = (value) => {
  return (
    value &&
    typeof value === "object" &&
    ("preference" in value || "priority" in value) &&
    "exchange" in value
  );
};
</script>
