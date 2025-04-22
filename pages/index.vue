<template>
  <div
    class="flex flex-col md:flex-row min-h-screen bg-gradient-to-br from-darker to-dark text-snow"
  >
    <Sidebar
      :domain-files="domainFiles"
      :selected-domain="selectedDomain"
      @select-domain="selectDomain"
    />

    <main class="flex-1 p-8 overflow-auto">
      <div class="max-w-6xl mx-auto">
        <div class="space-y-4">
          <div class="flex items-center justify-between w-full">
            <h1 class="text-2xl font-bold text-primary flex gap-3">
              <Icon name="material-symbols:dns" size="2rem" />
              {{ selectedDomain.replace(".yaml", "") }}
            </h1>

            <div class="flex items-center gap-2">
              <button
                class="w-10 h-10 flex items-center justify-center rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-all duration-300 text-red-500"
                title="Edit DNS Records"
              >
                <Icon name="material-symbols:edit-outline" size="1.25rem" />
              </button>
              <a
                :href="`https://github.com/hackclub/dns/blob/main/${selectedDomain}`"
                target="_blank"
              >
                <button
                  class="w-10 h-10 flex items-center justify-center rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-all duration-300 text-red-500 cursor-pointer"
                  title="View Source"
                >
                  <Icon name="material-symbols:code" size="1.25rem" /></button
              ></a>
            </div>
          </div>

          <Search v-model="searchQuery" />
        </div>

        <!-- X records found -->

        <div v-if="filteredRecords.length > 0" class="text-muted text-sm mt-4">
          {{ filteredRecords.length }} records found
          <span v-if="searchQuery" class="text-primary">
            (searching for "{{ searchQuery }}")
          </span>
        </div>

        <div v-if="loading" class="flex items-center justify-center p-12">
          <div class="text-primary">
            <Icon name="codex:loader" size="4em" />
          </div>
        </div>

        <div
          v-else-if="error"
          class="p-4 rounded-lg bg-yellow/10 border border-yellow/20 text-yellow flex items-center gap-2"
        >
          <Icon name="material-symbols:warning-rounded" size="2rem" />
          {{ error }}
        </div>

        <div v-else class="space-y-4 mt-6">
          <div
            v-if="filteredRecords.length === 0"
            class="text-center text-muted py-12"
          >
            No matching records or values found :(
          </div>

          <div
            v-for="(recordGroup, index) in filteredRecords"
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
                  size="1.5rem"
                />
                <span
                  v-html="highlightMatch(trim(recordGroup.subdomain))"
                ></span>
              </h2>
              <div class="flex items-center gap-2">
                <a
                  v-if="hasSite(recordGroup)"
                  :href="buildUrl(recordGroup)"
                  target="_blank"
                  class="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm transition-all duration-300 flex items-center gap-1"
                  title="Open site in new tab"
                  @click.stop
                >
                  <Icon name="material-symbols:open-in-new" size="1rem" />
                  Open
                </a>
                <Icon
                  name="icon-park-outline:down"
                  size="1.5rem"
                  class="text-muted transition-transform duration-300"
                  :class="{ 'rotate-180': expanded[index] }"
                />
              </div>
            </button>

            <div
              v-show="expanded[index]"
              class="px-6 pb-6 transition-all duration-300"
            >
              <RecordView
                :records="recordGroup.records"
                :search-query="searchQuery"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import yaml from "js-yaml"; // Import js-yaml for YAML parsing

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

const loading = ref(true);
const error = ref(null);
const records = ref([]);
const expanded = ref([]);
const selectedDomain = ref("hackclub.com.yaml");
const searchQuery = ref("");

const trim = (subdomain) => {
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
          ttl: record.ttl,
          values: record.values || record.value || [],
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

const highlightMatch = (text) => {
  if (!searchQuery.value) return text;
  const regex = new RegExp(`(${searchQuery.value})`, "gi");
  return text.replace(
    regex,
    '<span class="bg-primary/20 text-primary">$1</span>'
  );
};

// Filter and search records
const filteredRecords = computed(() => {
  if (!searchQuery.value) return records.value;

  const query = searchQuery.value.toLowerCase();

  return records.value.filter((group) => {
    if (group.subdomain.toLowerCase().includes(query)) return true;

    return group.records.some((record) => {
      if (record.type.toLowerCase().includes(query)) return true;

      if (Array.isArray(record.values)) {
        return record.values.some((value) => {
          if (typeof value === "object") {
            return Object.values(value).some((v) =>
              v.toString().toLowerCase().includes(query)
            );
          }
          return value.toString().toLowerCase().includes(query);
        });
      }

      return record.values.toString().toLowerCase().includes(query);
    });
  });
});

// Handle domain selection
const selectDomain = (domain) => {
  selectedDomain.value = domain;
  fetchRecords(domain);
};

const hasSite = (recordGroup) => {
  const validTypes = ["A", "AAAA", "CNAME", "ALIAS"];
  return recordGroup.records.some((record) => {
    if (!validTypes.includes(record.type)) return false;

    // Check for CNAME records pointing to amazonses.com
    if (record.type === "CNAME") {
      const values = Array.isArray(record.values)
        ? record.values
        : [record.values];
      return !values.some(
        (value) =>
          typeof value === "string" &&
          (value.includes("amazonses.com") ||
            value.includes("_acme.deno.dev") ||
            value.includes("acm-validations") ||
            value.includes("custom-email-domain.stripe.com") ||
            value.includes("verify.bing.com"))
      );
    }

    return true;
  });
};

const buildUrl = (recordGroup) => {
  const domain = selectedDomain.value.replace(".yaml", "");
  let subdomain = recordGroup.subdomain;
  if (subdomain === "@") {
    subdomain = "";
  }
  return `https://${subdomain ? `${subdomain}.` : ""}${domain}`;
};

// Fetch records for the default domain on mount
onMounted(() => {
  fetchRecords(selectedDomain.value);
});
</script>
