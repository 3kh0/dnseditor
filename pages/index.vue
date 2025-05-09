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
                class="w-10 h-10 flex items-center justify-center rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-all duration-300 text-red-500 cursor-pointer"
                title="Edit DNS Records"
                @click="showEditModal = true"
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

        <div v-if="matched.length > 0" class="text-muted text-sm mt-4">
          {{ matched.length }} records found
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
          <div v-if="matched.length === 0" class="text-center text-muted py-12">
            No matching records or values found :(
          </div>

          <div
            v-for="(group, index) in matched"
            :key="index"
            class="group rounded-xl border border-border/10 bg-darkless/40 backdrop-blur-md shadow-lg transition-all duration-300 hover:shadow-xl hover:bg-darkless/60"
          >
            <button
              class="w-full px-6 py-4 flex justify-between items-center"
              @click="touch(index)"
            >
              <h2
                class="text-lg font-semibold text-primary flex items-center gap-2"
              >
                <Icon
                  name="material-symbols:settop-component-rounded"
                  size="1.5rem"
                />
                <span
                  v-html="
                    expanded[index]
                      ? group.subdomain
                      : light(trim(group.subdomain))
                  "
                ></span>
              </h2>
              <div class="flex items-center gap-2">
                <a
                  v-if="hasSite(group)"
                  :href="buildUrl(group)"
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
                :records="group.records"
                :search-query="searchQuery"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
  <EditModal
    :show="showEditModal"
    :domain="selectedDomain"
    @close="showEditModal = false"
  />
</template>

<script setup>
import yaml from "js-yaml";

const domainFiles = [
  // update as needed
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
const showEditModal = ref(false);

const trim = (subdomain) => {
  if (subdomain.length > 20) {
    return `${subdomain.slice(0, 10)}...${subdomain.slice(-10)}`;
  }
  return subdomain || "Root Domain";
};

const touch = (index) => {
  expanded.value[index] = !expanded.value[index];
};

const yoink = async (domain) => {
  loading.value = true;
  error.value = null;
  records.value = [];
  expanded.value = [];

  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/hackclub/dns/refs/heads/main/${domain}` // would use jsdelivr, but cache is too long
      // `https://cdn.jsdelivr.net/gh/hackclub/dns@main/${domain}`
    );
    if (!response.ok) throw new Error(`failed to fetch ${domain}`);
    const yamlText = await response.text();
    const data = yaml.load(yamlText); //json actually

    // trans~~gender~~ data
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

const light = (text) => {
  if (!searchQuery.value) return text;
  const regex = new RegExp(`(${searchQuery.value})`, "gi");
  return text.replace(
    regex,
    '<span class="bg-primary/20 text-primary">$1</span>'
  );
};

const matched = computed(() => {
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

const selectDomain = (domain) => {
  selectedDomain.value = domain;
  yoink(domain);
};

const hasSite = (group) => {
  const validTypes = ["A", "AAAA", "CNAME", "ALIAS"];
  return group.records.some((record) => {
    if (!validTypes.includes(record.type)) return false;

    // cname but no site, lets check that
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

const buildUrl = (group) => {
  const domain = selectedDomain.value.replace(".yaml", "");
  let subdomain = group.subdomain;
  if (subdomain === "@") {
    subdomain = "";
  }
  return `https://${subdomain ? `${subdomain}.` : ""}${domain}`;
};

// first load
onMounted(() => {
  yoink(selectedDomain.value);
});
</script>
