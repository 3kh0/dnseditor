<script setup lang="ts">
import { DEFAULT_DOMAIN, DOMAIN_FILES, type DomainFile } from "#shared/dns";
import type { DnsRecordGroup, DnsValue } from "#shared/types/dns";

useSeoMeta({
  title: "Hack Club DNS Viewer",
  description: "Browse DNS records managed in the Hack Club DNS repository.",
});

const selectedDomain = ref<DomainFile>(DEFAULT_DOMAIN);
const searchQuery = ref("");
const showEditModal = ref(false);
const expanded = ref(new Set<string>());

const {
  data: records,
  error,
  status,
} = await useFetch<DnsRecordGroup[]>(() => `/api/domains/${selectedDomain.value}`, {
  default: () => [],
  watch: [selectedDomain],
});

const loading = computed(() => status.value === "pending");
const errorMessage = computed(() =>
  error.value ? (error.value.statusMessage ?? error.value.message) : "",
);

const matched = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return records.value;

  return records.value.filter((group) => {
    if (group.subdomain.toLocaleLowerCase().includes(query)) return true;

    return group.records.some(
      (record) =>
        record.type.toLocaleLowerCase().includes(query) ||
        record.values.some((value) => searchableValue(value).includes(query)),
    );
  });
});

watch(selectedDomain, () => {
  expanded.value = new Set();
});

function searchableValue(value: DnsValue) {
  return (typeof value === "object" ? JSON.stringify(value) : String(value)).toLocaleLowerCase();
}

function selectDomain(domain: DomainFile) {
  selectedDomain.value = domain;
}

function toggleGroup(subdomain: string) {
  const next = new Set(expanded.value);
  if (next.has(subdomain)) {
    next.delete(subdomain);
  } else {
    next.add(subdomain);
  }
  expanded.value = next;
}

function displaySubdomain(subdomain: string, isExpanded: boolean) {
  if (!subdomain || subdomain === "@") return "Root Domain";
  if (isExpanded || subdomain.length <= 20) return subdomain;
  return `${subdomain.slice(0, 10)}...${subdomain.slice(-10)}`;
}

function hasSite(group: DnsRecordGroup) {
  const validTypes = new Set(["A", "AAAA", "CNAME", "ALIAS"]);
  const nonSiteTargets = [
    "amazonses.com",
    "_acme.deno.dev",
    "acm-validations",
    "custom-email-domain.stripe.com",
    "verify.bing.com",
  ];

  return group.records.some((record) => {
    if (!validTypes.has(record.type)) return false;
    if (record.type !== "CNAME") return true;

    return !record.values.some(
      (value) =>
        typeof value === "string" && nonSiteTargets.some((target) => value.includes(target)),
    );
  });
}

function siteUrl(group: DnsRecordGroup) {
  const domain = selectedDomain.value.replace(/\.yaml$/, "");
  const subdomain = group.subdomain === "@" ? "" : group.subdomain;
  return `https://${subdomain ? `${subdomain}.` : ""}${domain}`;
}
</script>

<template>
  <div
    class="flex min-h-screen flex-col bg-gradient-to-br from-darker to-dark text-snow md:flex-row"
  >
    <DomainSidebar
      :domain-files="DOMAIN_FILES"
      :selected-domain="selectedDomain"
      @select-domain="selectDomain"
    />

    <main class="flex-1 overflow-auto p-5 sm:p-8">
      <div class="mx-auto max-w-6xl">
        <header class="space-y-4">
          <div class="flex w-full items-center justify-between gap-4">
            <h1 class="flex min-w-0 items-center gap-3 text-2xl font-bold text-primary">
              <Icon name="material-symbols:dns" size="2rem" class="shrink-0" />
              <span class="truncate">{{ selectedDomain.replace(/\.yaml$/, "") }}</span>
            </h1>

            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="flex size-10 cursor-pointer items-center justify-center rounded-lg bg-red-500/20 text-red-500 transition-colors hover:bg-red-500/30"
                title="Edit DNS Records"
                @click="showEditModal = true"
              >
                <Icon name="material-symbols:edit-outline" size="1.25rem" />
              </button>
              <a
                :href="`https://github.com/hackclub/dns/blob/main/${selectedDomain}`"
                target="_blank"
                rel="noreferrer"
                class="flex size-10 items-center justify-center rounded-lg bg-red-500/20 text-red-500 transition-colors hover:bg-red-500/30"
                title="View Source"
              >
                <Icon name="material-symbols:code" size="1.25rem" />
              </a>
            </div>
          </div>

          <DnsSearch v-model="searchQuery" />
        </header>

        <p v-if="!loading && !error" class="mt-4 text-sm text-muted" aria-live="polite">
          {{ matched.length }} records found
          <span v-if="searchQuery" class="text-primary"> (searching for “{{ searchQuery }}”) </span>
        </p>

        <div v-if="loading" class="flex items-center justify-center p-12">
          <Icon
            name="material-symbols:progress-activity"
            size="4em"
            class="animate-spin text-primary"
          />
        </div>

        <div
          v-else-if="error"
          class="mt-6 flex items-center gap-2 rounded-lg border border-yellow/20 bg-yellow/10 p-4 text-yellow"
        >
          <Icon name="material-symbols:warning-rounded" size="2rem" />
          {{ errorMessage }}
        </div>

        <div v-else class="mt-6 space-y-4">
          <p v-if="matched.length === 0" class="py-12 text-center text-muted">
            No matching records or values found :(
          </p>

          <section
            v-for="group in matched"
            :key="group.subdomain"
            class="group rounded-xl border border-border/10 bg-darkless/40 shadow-lg backdrop-blur-md transition-colors hover:bg-darkless/60"
          >
            <div class="flex w-full items-center justify-between px-6 py-4">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left text-lg font-semibold text-primary"
                :aria-expanded="expanded.has(group.subdomain)"
                @click="toggleGroup(group.subdomain)"
              >
                <Icon
                  name="material-symbols:settop-component-rounded"
                  size="1.5rem"
                  class="shrink-0"
                />
                <span class="truncate">
                  <HighlightedText
                    :text="displaySubdomain(group.subdomain, expanded.has(group.subdomain))"
                    :query="searchQuery"
                  />
                </span>
              </button>

              <div class="ml-3 flex shrink-0 items-center gap-2">
                <a
                  v-if="hasSite(group)"
                  :href="siteUrl(group)"
                  target="_blank"
                  rel="noreferrer"
                  class="flex items-center gap-1 rounded-lg bg-primary/20 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/30"
                  title="Open site in new tab"
                >
                  <Icon name="material-symbols:open-in-new" size="1rem" />
                  <span class="hidden sm:inline">Open</span>
                </a>
                <button
                  type="button"
                  class="p-1 text-muted"
                  :aria-label="
                    expanded.has(group.subdomain) ? 'Collapse records' : 'Expand records'
                  "
                  @click="toggleGroup(group.subdomain)"
                >
                  <Icon
                    name="icon-park-outline:down"
                    size="1.5rem"
                    class="block transition-transform"
                    :class="{ 'rotate-180': expanded.has(group.subdomain) }"
                  />
                </button>
              </div>
            </div>

            <div v-show="expanded.has(group.subdomain)" class="px-6 pb-6">
              <DnsRecordTable :records="group.records" :search-query="searchQuery" />
            </div>
          </section>
        </div>
      </div>
    </main>

    <EditNoticeModal :show="showEditModal" @close="showEditModal = false" />
  </div>
</template>
