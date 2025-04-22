<template>
  <div class="flex flex-col md:flex-row min-h-screen bg-dark text-snow">
    <!-- Sidebar -->
    <aside
      class="w-full md:w-64 bg-darkless/70 backdrop-blur-md p-4 border-r border-border"
    >
      <h2 class="text-lg font-bold mb-4 text-primary">Domains</h2>
      <ul class="space-y-2">
        <li
          v-for="(domain, index) in domainFiles"
          :key="index"
          class="cursor-pointer p-2 rounded hover:bg-dark transition-all duration-300"
          :class="{ 'bg-primary text-snow': selectedDomain === domain }"
          @click="selectDomain(domain)"
        >
          {{ domain.replace(".yaml", "") }}
        </li>
      </ul>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 p-8">
      <h1 class="text-4xl font-bold mb-6 text-primary">
        {{ selectedDomain.replace(".yaml", "") }} DNS Records
      </h1>
      <div v-if="loading" class="text-muted animate-pulse">Loading...</div>
      <div v-else-if="error" class="text-yellow">Error: {{ error }}</div>
      <div v-else>
        <div class="space-y-4">
          <div
            v-for="(recordGroup, index) in records"
            :key="index"
            class="bg-darkless/70 backdrop-blur-md p-4 rounded-lg border border-border shadow-md transition-all duration-300"
          >
            <div
              class="flex justify-between items-center cursor-pointer"
              @click="toggleRecord(index)"
            >
              <h2 class="text-lg font-bold text-primary">
                {{ trimSubdomain(recordGroup.subdomain) }}
              </h2>
              <span
                class="text-muted transform transition-transform duration-300"
                :class="{ 'rotate-180': expanded[index] }"
              >
                ▼
              </span>
            </div>
            <div
              v-if="expanded[index]"
              class="mt-4 overflow-hidden transition-all duration-300"
            >
              <table
                class="table-auto w-full border-collapse border border-border"
              >
                <thead>
                  <tr class="bg-primary text-snow">
                    <th class="px-4 py-2 border border-border">Type</th>
                    <th class="px-4 py-2 border border-border">Value(s)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(record, idx) in recordGroup.records"
                    :key="idx"
                    class="hover:bg-dark transition-all duration-300"
                  >
                    <td class="px-4 py-2 border border-border">
                      {{ record.type }}
                    </td>
                    <td class="px-4 py-2 border border-border">
                      <div v-if="Array.isArray(record.values)">
                        <ul>
                          <li
                            v-for="(value, valueIdx) in record.values"
                            :key="valueIdx"
                          >
                            <div v-if="record.type === 'MX'">
                              Priority: {{ value.priority }}, Exchange:
                              {{ value.exchange }}
                            </div>
                            <div v-else-if="record.type === 'SSHFP'">
                              Algorithm: {{ value.algorithm }}, Fingerprint
                              Type: {{ value.fingerprint_type }}, Fingerprint:
                              {{ value.fingerprint }}
                            </div>
                            <div v-else>
                              {{ value }}
                            </div>
                          </li>
                        </ul>
                      </div>
                      <div v-else>
                        {{ record.values }}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
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
  if (subdomain.length > 15) {
    return `${subdomain.slice(0, 6)}...${subdomain.slice(-6)}`;
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
