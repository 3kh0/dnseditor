<template>
  <div
    class="flex flex-col md:flex-row min-h-screen bg-gradient-to-br from-darker to-dark text-snow"
  >
    <!-- Sidebar -->
    <aside
      class="w-full md:w-72 bg-darkless/40 backdrop-blur-xl p-6 border-r border-border/20 shadow-xl"
    >
      <h2 class="text-xl font-bold mb-6 text-primary flex items-center gap-2">
        <Icon name="material-symbols:globe" class="w-6 h-6" />
        Hack Club DNS
      </h2>
      <div class="space-y-1">
        <button
          v-for="(domain, index) in domainFiles"
          :key="index"
          class="w-full text-left px-4 py-3 rounded-lg transition-all duration-300 hover:scale-102 group"
          :class="{
            'bg-primary/20 text-primary border border-primary/20':
              selectedDomain === domain,
            'hover:bg-darkless/80': selectedDomain !== domain,
          }"
          @click="selectDomain(domain)"
        >
          <span class="line-clamp-1">{{ domain.replace(".yaml", "") }}</span>
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 p-8 overflow-auto">
      <div class="max-w-6xl mx-auto">
        <h1
          class="text-4xl font-bold mb-8 text-primary flex items-center gap-3"
        >
          <Icon name="material-symbols:dns" class="w-8 h-8" />
          {{ selectedDomain.replace(".yaml", "") }}
        </h1>

        <div v-if="loading" class="flex items-center justify-center p-2">
          <div class="text-primary">
            <Icon name="codex:loader" size="4em" />
          </div>
        </div>

        <div
          v-else-if="error"
          class="p-4 rounded-lg bg-yellow/10 border border-yellow/20 text-yellow flex items-center gap-2"
        >
          <Icon name="material-symbols:warning-rounded" class="w-5 h-5" />
          {{ error }}
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="(recordGroup, index) in records"
            :key="index"
            class="group rounded-xl border border-border/10 bg-darkless/40 backdrop-blur-md shadow-lg transition-all duration-300 hover:shadow-xl hover:bg-darkless/60"
          >
            <button
              class="w-full px-6 py-4 flex justify-between items-center"
              @click="toggleRecord(index)"
            >
              <h2
                class="text-lg font-semibold text-primary flex items-center gap-2"
              >
                <Icon
                  name="material-symbols:settop-component-rounded"
                  class="w-5 h-5"
                />
                {{ trimSubdomain(recordGroup.subdomain) }}
              </h2>
              <Icon
                name="icon-park-outline:down"
                class="w-5 h-5 text-muted transition-transform duration-300"
                :class="{ 'rotate-180': expanded[index] }"
              />
            </button>

            <div
              v-show="expanded[index]"
              class="px-6 pb-6 transition-all duration-300"
            >
              <div class="overflow-x-auto rounded-lg border border-border/10">
                <table class="w-full">
                  <thead>
                    <tr class="bg-primary/10">
                      <th class="px-6 py-3 text-left text-sm font-semibold">
                        Type
                      </th>
                      <th class="px-6 py-3 text-left text-sm font-semibold">
                        Value(s)
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border/10">
                    <tr
                      v-for="(record, idx) in recordGroup.records"
                      :key="idx"
                      class="group/row hover:bg-darkless/80"
                    >
                      <td class="px-6 py-4 text-sm font-medium">
                        {{ record.type }}
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
                                {{ value.priority }},
                                <span class="text-muted">Exchange:</span>
                                {{ value.exchange }}
                              </template>
                              <template v-else-if="record.type === 'SSHFP'">
                                <span class="text-muted">Algorithm:</span>
                                {{ value.algorithm }},
                                <span class="text-muted">Type:</span>
                                {{ value.fingerprint_type }},
                                <span class="text-muted">Fingerprint:</span>
                                {{ value.fingerprint }}
                              </template>
                              <template v-else>{{ value }}</template>
                            </li>
                          </ul>
                        </div>
                        <div v-else>{{ record.values }}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import yaml from "js-yaml"; // Import js-yaml for YAML parsing

const loading = ref(true);
const error = ref(null);
const records = ref([]);
const expanded = ref([]);
const selectedDomain = ref("hackclub.com.yaml");

// List of domain files
const domainFiles = [
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
  "hackclub.io.yaml",
  "hackclub.org.yaml",
  "hackedu.us.yaml",
  "hackfoundation.org.yaml",
  "nonprofit.new.yaml",
];

// Utility function to trim long subdomains
const trimSubdomain = (subdomain) => {
  if (subdomain.length > 20) {
    return `${subdomain.slice(0, 10)}...${subdomain.slice(-10)}`;
  }
  return subdomain || "Root Domain";
};

// Toggle record expansion
const toggleRecord = (index) => {
  expanded.value[index] = !expanded.value[index];
};

// Fetch DNS records for the selected domain
const fetchRecords = async (domain) => {
  loading.value = true;
  error.value = null;
  records.value = [];
  expanded.value = [];

  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/hackclub/dns/refs/heads/main/${domain}`
    );
    if (!response.ok) throw new Error(`Failed to fetch ${domain}`);
    const yamlText = await response.text();

    // Parse YAML into JSON
    const data = yaml.load(yamlText);

    // Transform parsed YAML data into a usable format
    records.value = Object.entries(data).map(([subdomain, recordList]) => ({
      subdomain,
      records: (Array.isArray(recordList) ? recordList : [recordList]).map(
        (record) => ({
          type: record.type,
          values: record.values || record.value,
        })
      ),
    }));

    expanded.value = Array(records.value.length).fill(false);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

// Handle domain selection
const selectDomain = (domain) => {
  selectedDomain.value = domain;
  fetchRecords(domain);
};

// Fetch records for the default domain on mount
onMounted(() => {
  fetchRecords(selectedDomain.value);
});
</script>
