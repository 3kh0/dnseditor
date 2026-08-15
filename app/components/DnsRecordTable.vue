<script setup lang="ts">
import {
  bareDomain,
  CNAME_PROVIDER_LABELS,
  detectCnameProvider,
  fmtDnsValue,
  supportsCfProxy,
  type CnameProvider,
} from "#shared/dns";
import type { DnsMxValue, DnsRecordGroup, DnsValue } from "#shared/types/dns";

const props = defineProps<{
  domain: string;
  groups: DnsRecordGroup[];
  searchQuery?: string;
}>();

const emit = defineEmits<{
  edit: [payload: EditPayload];
  delete: [payload: EditPayload];
}>();

export interface EditPayload {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference?: number;
  proxied?: boolean;
  contact?: string;
}

interface Row {
  siteUrl: string | null;
  subdomain: string;
  ttl?: number;
  type: string;
  value: DnsValue;
  proxied?: boolean;
  provider: CnameProvider | null;
  contact?: string;
}

const MOBILE_PAGE_SIZE = 50;
const mobileLimit = ref(MOBILE_PAGE_SIZE);
const isMobile = ref(true);
const openMenu = ref<number | null>(null);
let mobileMedia: MediaQueryList | null = null;

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
        provider: detectCnameProvider(r.type, value),
        contact: g.contact,
      })),
    ),
  ),
);

const mobileRows = computed(() => rows.value.slice(0, mobileLimit.value));

function updateMobileLayout(event: MediaQueryList | MediaQueryListEvent) {
  isMobile.value = event.matches;
  if (!event.matches) closeMenu();
}

function closeMenu() {
  openMenu.value = null;
}

function toggleMenu(i: number) {
  openMenu.value = openMenu.value === i ? null : i;
}

function onDocPointerDown(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest("[data-record-menu]")) return;
  closeMenu();
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeMenu();
}

onMounted(() => {
  mobileMedia = window.matchMedia("(max-width: 767px)");
  updateMobileLayout(mobileMedia);
  mobileMedia.addEventListener("change", updateMobileLayout);
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onDocKeydown);
});

onBeforeUnmount(() => {
  mobileMedia?.removeEventListener("change", updateMobileLayout);
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onDocKeydown);
});

watch([() => props.groups, () => props.searchQuery], () => {
  mobileLimit.value = MOBILE_PAGE_SIZE;
  closeMenu();
});

const isMx = (v: DnsValue): v is DnsMxValue => typeof v === "object" && v !== null;

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

function toPayload(row: Row): EditPayload {
  if (row.type === "MX" && isMx(row.value)) {
    return {
      subdomain: row.subdomain,
      type: row.type,
      value: row.value.exchange ? String(row.value.exchange) : "",
      ttl: row.ttl,
      mxPreference: Number(row.value.preference ?? row.value.priority ?? 10),
      proxied: row.proxied,
      contact: row.contact,
    };
  }

  return {
    subdomain: row.subdomain,
    type: row.type,
    value: row.value === "" ? "" : fmtDnsValue(row.value),
    ttl: row.ttl,
    proxied: row.proxied,
    contact: row.contact,
  };
}

function onEdit(row: Row) {
  closeMenu();
  emit("edit", toPayload(row));
}

function onDelete(row: Row) {
  closeMenu();
  emit("delete", toPayload(row));
}

function formatTtl(ttl?: number): string {
  if (ttl === undefined) return "Auto";
  if (ttl % 86400 === 0) {
    const days = ttl / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (ttl % 3600 === 0) {
    const hours = ttl / 3600;
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }
  if (ttl % 60 === 0) return `${ttl / 60} min`;
  return `${ttl}s`;
}

function showProxy(row: Row) {
  return supportsCfProxy(props.domain, row.type);
}

function contentText(row: Row): string {
  if (row.type === "MX" && isMx(row.value)) {
    const priority = row.value.priority ?? row.value.preference;
    const exchange = row.value.exchange || "Invalid";
    return priority === undefined ? exchange : `${priority} ${exchange}`;
  }
  if (row.value === "") return "No value";
  return fmtDnsValue(row.value);
}
</script>

<template>
  <div>
    <div v-if="isMobile" class="md:hidden">
      <p class="mb-2.5 text-sm font-medium text-snow">
        {{ rows.length }} {{ rows.length === 1 ? "record" : "records" }}
      </p>

      <div class="space-y-1.5">
        <article
          v-for="(row, i) in mobileRows"
          :key="i"
          class="relative rounded-xl border border-border bg-dark"
          :class="openMenu === i ? 'z-20' : ''"
        >
          <button
            type="button"
            class="w-full rounded-xl px-3 pt-2.5 pb-0 text-left active:bg-darkless"
            :aria-label="`Edit ${row.type} record for ${displayName(row.subdomain)}`"
            @click="onEdit(row)"
          >
            <div class="flex items-center gap-2 pr-8">
              <span
                class="inline-flex h-6 items-center justify-center rounded-md bg-darkless px-1.5 font-mono text-[10px] font-semibold tracking-wide text-snow"
              >
                <HighlightedText :text="row.type" :query="searchQuery" />
              </span>

              <span
                v-if="showProxy(row)"
                class="ml-auto inline-flex items-center gap-1 text-xs text-muted"
              >
                <Icon
                  :name="row.proxied ? 'material-symbols:cloud' : 'material-symbols:cloud-outline'"
                  size="0.95rem"
                  class="shrink-0"
                  :class="row.proxied ? 'text-orange' : 'text-muted'"
                />
                {{ row.proxied ? "Proxied" : "DNS only" }}
              </span>
            </div>

            <h3 class="mt-1.5 break-all text-sm leading-5 font-medium text-snow">
              <HighlightedText :text="displayName(row.subdomain)" :query="searchQuery" />
            </h3>

            <div class="mt-0.5 flex min-w-0 items-center gap-1.5 pb-2 text-[13px] text-muted">
              <template v-if="row.provider">
                <Icon
                  v-if="row.provider === 'vercel'"
                  name="simple-icons:vercel"
                  size="0.8rem"
                  class="shrink-0 text-snow"
                />
                <span
                  v-else-if="row.provider === 'coolify-a' || row.provider === 'coolify-b'"
                  class="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[9px] font-bold leading-none text-primary"
                  aria-hidden="true"
                >
                  {{ row.provider === "coolify-a" ? "A" : "B" }}
                </span>
                <OrchardIcon v-else-if="row.provider === 'orchard'" />
                <span class="truncate text-snow/80">{{ CNAME_PROVIDER_LABELS[row.provider] }}</span>
              </template>
              <span
                v-else
                class="truncate"
                :class="row.type === 'TXT' ? 'font-mono text-xs text-snow/80' : 'text-snow/80'"
              >
                <HighlightedText :text="contentText(row)" :query="searchQuery" />
              </span>
            </div>

            <div
              class="flex items-center justify-between border-t border-border/60 py-2 text-xs text-muted"
            >
              <span>TTL {{ formatTtl(row.ttl) }}</span>
              <Icon name="material-symbols:chevron-right-rounded" size="1.15rem" class="-mr-1" />
            </div>
          </button>

          <div class="absolute top-1.5 right-1" data-record-menu>
            <button
              type="button"
              class="flex size-10 items-center justify-center rounded-lg text-muted active:bg-darkless active:text-snow"
              :aria-label="`More actions for ${displayName(row.subdomain)}`"
              aria-haspopup="menu"
              :aria-expanded="openMenu === i"
              @click="toggleMenu(i)"
            >
              <Icon name="material-symbols:more-horiz" size="1.25rem" />
            </button>

            <Transition name="fade">
              <div
                v-if="openMenu === i"
                role="menu"
                class="absolute top-10 right-1 z-30 min-w-40 overflow-hidden rounded-lg border border-border bg-darkless py-1 shadow-xl"
              >
                <a
                  v-if="row.siteUrl"
                  :href="row.siteUrl"
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  class="flex items-center gap-2 px-3 py-2.5 text-sm text-snow active:bg-dark"
                >
                  <Icon name="material-symbols:open-in-new" size="1rem" class="text-muted" />
                  Open site
                </a>
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-snow active:bg-dark"
                  @click="onEdit(row)"
                >
                  <Icon name="material-symbols:edit-outline" size="1rem" class="text-muted" />
                  Edit
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red active:bg-red/10"
                  @click="onDelete(row)"
                >
                  <Icon name="material-symbols:delete-outline" size="1rem" />
                  Delete
                </button>
              </div>
            </Transition>
          </div>
        </article>
      </div>

      <div v-if="mobileRows.length < rows.length" class="pt-2">
        <button
          type="button"
          class="min-h-11 w-full rounded-xl border border-border bg-dark px-4 text-sm font-medium text-snow active:bg-darkless"
          @click="mobileLimit += MOBILE_PAGE_SIZE"
        >
          Show {{ Math.min(MOBILE_PAGE_SIZE, rows.length - mobileRows.length) }} more records
        </button>
      </div>
    </div>

    <div v-else class="hidden overflow-hidden rounded-lg border border-border bg-dark md:block">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <p class="text-sm font-medium text-snow">
          {{ rows.length }} {{ rows.length === 1 ? "record" : "records" }}
        </p>
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
              <td
                class="max-w-64 truncate px-4 py-2.5 text-snow"
                :title="displayName(row.subdomain)"
              >
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

                <span v-else-if="row.provider" class="inline-flex items-center gap-1.5 text-snow">
                  <Icon
                    v-if="row.provider === 'vercel'"
                    name="simple-icons:vercel"
                    size="0.875rem"
                    class="shrink-0"
                  />
                  <span
                    v-else-if="row.provider === 'coolify-a' || row.provider === 'coolify-b'"
                    class="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[10px] font-bold leading-none text-primary"
                    aria-hidden="true"
                  >
                    {{ row.provider === "coolify-a" ? "A" : "B" }}
                  </span>
                  <OrchardIcon v-else-if="row.provider === 'orchard'" />
                  {{ CNAME_PROVIDER_LABELS[row.provider] }}
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
              <td class="px-4 py-2.5 whitespace-nowrap text-muted">
                <span class="inline-flex items-center gap-1.5">
                  <Icon
                    v-if="domain === 'hackclub.com.yaml' && row.proxied && row.ttl === undefined"
                    name="simple-icons:cloudflare"
                    size="0.875rem"
                    class="shrink-0 text-orange"
                    title="Proxied through Cloudflare"
                  />
                  {{ row.ttl ?? "Auto" }}
                </span>
              </td>
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
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1 text-xs text-muted transition-colors hover:text-red"
                    title="Delete this record"
                    @click="onDelete(row)"
                  >
                    <Icon name="material-symbols:delete-outline" size="0.875rem" />
                    Delete
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
  </div>
</template>
