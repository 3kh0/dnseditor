<script setup lang="ts">
import {
  bareDomain,
  DEFAULT_DOMAIN,
  DOMAIN_FILES,
  fmtDnsValue,
  type DomainFile,
} from "#shared/dns";
import type { DnsRecordGroup, DnsValue } from "#shared/types/dns";

useSeoMeta({
  title: "Hack Club DNS Editor",
  description: "Browse Hack Club DNS records and open pull requests to add subdomains.",
});

const route = useRoute();
const router = useRouter();

const selectedDomain = ref<DomainFile>(DEFAULT_DOMAIN);
const searchQuery = ref("");
const showEditModal = ref(false);
const authError = ref<string | null>(null);

export interface EditingRecord {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference?: number;
  proxied?: boolean;
}

const editingRecord = ref<EditingRecord | null>(null);
const modalMode = ref<"edit" | "delete">("edit");

function openAdd() {
  editingRecord.value = null;
  showEditModal.value = true;
}

function openEdit(record: EditingRecord) {
  editingRecord.value = record;
  modalMode.value = "edit";
  showEditModal.value = true;
}

function openDelete(record: EditingRecord) {
  editingRecord.value = record;
  modalMode.value = "delete";
  showEditModal.value = true;
}

function closeModal() {
  showEditModal.value = false;
  editingRecord.value = null;
}

onMounted(() => {
  const err = typeof route.query.authError === "string" ? route.query.authError : null;
  if (err) authError.value = err;

  if (route.query.openAdd === "1") {
    const d = typeof route.query.domain === "string" ? route.query.domain : "";
    if (d && (DOMAIN_FILES as readonly string[]).includes(d)) {
      selectedDomain.value = d as DomainFile;
    }
    openAdd();
  }

  if (route.query.authError || route.query.openAdd) {
    const q = { ...route.query };
    delete q.authError;
    delete q.openAdd;
    delete q.domain;
    router.replace({ query: q });
  }
});

const {
  data: records,
  error,
  status,
} = useLazyFetch<DnsRecordGroup[]>(() => `/api/domains/${selectedDomain.value}`, {
  default: () => [],
  watch: [selectedDomain],
});

const loading = computed(() => status.value === "pending");
const errorMessage = computed(() =>
  error.value ? (error.value.statusMessage ?? error.value.message) : "",
);
const bare = computed(() => bareDomain(selectedDomain.value));

const searchable = (v: DnsValue) => fmtDnsValue(v).toLocaleLowerCase();

const matched = computed(() => {
  const q = searchQuery.value.trim().toLocaleLowerCase();
  if (!q) return records.value;

  return records.value.filter(
    (g) =>
      g.subdomain.toLocaleLowerCase().includes(q) ||
      g.records.some(
        (r) =>
          r.type.toLocaleLowerCase().includes(q) || r.values.some((v) => searchable(v).includes(q)),
      ),
  );
});
</script>

<template>
  <div class="flex min-h-screen flex-col bg-darker text-snow md:flex-row">
    <DomainSidebar
      :domain-files="DOMAIN_FILES"
      :selected-domain="selectedDomain"
      @select-domain="selectedDomain = $event"
    />

    <main class="flex-1 overflow-auto p-5 sm:p-8">
      <div class="mx-auto max-w-6xl">
        <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h1 class="truncate text-2xl font-semibold text-snow">DNS records for {{ bare }}</h1>
            <p class="mt-1 text-sm text-muted">
              Browse records for this domain and open pull requests to add or edit subdomains from
              your fork.
            </p>
          </div>
          <UserMenu class="shrink-0 self-start" />
        </header>

        <div
          v-if="authError"
          class="mt-4 flex items-start gap-2 rounded-lg border border-red/20 bg-red/10 p-3 text-sm text-red"
        >
          <Icon name="material-symbols:error-outline" class="mt-0.5 shrink-0" size="1.1rem" />
          <p class="min-w-0 flex-1">{{ authError }}</p>
          <button
            type="button"
            class="shrink-0 text-red/80 hover:text-red"
            aria-label="Dismiss"
            @click="authError = null"
          >
            <Icon name="material-symbols:close-rounded" size="1.1rem" />
          </button>
        </div>

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
            @click="openAdd"
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
            @edit="openEdit"
            @delete="openDelete"
          />
        </template>
      </div>
    </main>

    <EditRecordModal
      :show="showEditModal"
      :domain="selectedDomain"
      :editing="editingRecord"
      :initial-mode="modalMode"
      @close="closeModal"
    />
  </div>
</template>
