<script setup lang="ts">
import { DEFAULT_DOMAIN, DOMAIN_FILES, type DomainFile } from "#shared/dns";
import type { DnsRecordGroup, DnsValue } from "#shared/types/dns";

useSeoMeta({
  title: "Hack Club DNS Editor",
  description: "Browse Hack Club DNS records and open pull requests to add subdomains.",
});

const selectedDomain = ref<DomainFile>(DEFAULT_DOMAIN);
const searchQuery = ref("");
const showEditModal = ref(false);

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

const bareDomain = computed(() => selectedDomain.value.replace(/\.yaml$/, ""));

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

function searchableValue(value: DnsValue) {
  return (typeof value === "object" ? JSON.stringify(value) : String(value)).toLocaleLowerCase();
}

function selectDomain(domain: DomainFile) {
  selectedDomain.value = domain;
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-darker text-snow md:flex-row">
    <DomainSidebar
      :domain-files="DOMAIN_FILES"
      :selected-domain="selectedDomain"
      @select-domain="selectDomain"
    />

    <main class="flex-1 overflow-auto p-5 sm:p-8">
      <div class="mx-auto max-w-6xl">
        <header>
          <h1 class="truncate text-2xl font-semibold text-snow">
            DNS records for {{ bareDomain }}
          </h1>
          <p class="mt-1 text-sm text-muted">
            Browse records for this domain and open pull requests to add subdomains.
          </p>
        </header>

        <div class="mt-6 flex items-center gap-2">
          <DnsSearch v-model="searchQuery" class="min-w-0 flex-1" />

          <a
            :href="`https://github.com/hackclub/dns/blob/main/${selectedDomain}`"
            target="_blank"
            rel="noreferrer"
            class="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-dark px-3 py-2 text-sm text-snow transition-colors hover:bg-darkless"
            title="View source on GitHub"
          >
            <Icon name="material-symbols:code" size="1rem" />
            <span class="hidden sm:inline">Source</span>
          </a>

          <button
            type="button"
            class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/85"
            @click="showEditModal = true"
          >
            <Icon name="material-symbols:add" size="1rem" />
            Add record
          </button>
        </div>

        <p
          v-if="searchQuery && !loading && !error"
          class="mt-3 text-xs text-muted"
          aria-live="polite"
        >
          Showing results for “{{ searchQuery }}”
        </p>

        <div v-if="loading" class="flex items-center justify-center p-12">
          <Icon
            name="material-symbols:progress-activity"
            size="3em"
            class="animate-spin text-primary"
          />
        </div>

        <div
          v-else-if="error"
          class="mt-6 flex items-center gap-2 rounded-lg border border-yellow/20 bg-yellow/10 p-4 text-yellow"
        >
          <Icon name="material-symbols:warning-rounded" size="1.5rem" />
          {{ errorMessage }}
        </div>

        <template v-else>
          <p
            v-if="matched.length === 0"
            class="mt-6 rounded-lg border border-border bg-dark py-12 text-center text-sm text-muted"
          >
            No matching records or values found.
          </p>

          <DnsRecordTable
            v-else
            class="mt-4"
            :groups="matched"
            :domain="selectedDomain"
            :search-query="searchQuery"
          />
        </template>
      </div>
    </main>

    <EditRecordModal
      :show="showEditModal"
      :domain="selectedDomain"
      @close="showEditModal = false"
    />
  </div>
</template>
