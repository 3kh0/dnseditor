<script setup lang="ts">
import { bareDomain, type DomainFile } from "#shared/dns";

const props = defineProps<{
  domainFiles: readonly DomainFile[];
  selectedDomain: DomainFile;
}>();

const emit = defineEmits<{ selectDomain: [domain: DomainFile] }>();

const mobileOpen = ref(false);

const PINNED: readonly DomainFile[] = ["hackclub.com.yaml", "dino.icu.yaml"];
const pinned = computed(() => props.domainFiles.filter((d) => PINNED.includes(d)));

const sections = computed(() => [
  { title: "Pinned", items: pinned.value },
  { title: "All domains", items: props.domainFiles },
]);

const btnClass = (d: DomainFile) =>
  props.selectedDomain === d
    ? "bg-darkless font-medium text-snow"
    : "text-muted hover:bg-darkless/60 hover:text-snow";

function selectDomain(domain: DomainFile) {
  emit("selectDomain", domain);
  mobileOpen.value = false;
}
</script>

<template>
  <aside
    class="relative z-30 w-full shrink-0 border-b border-border bg-black md:w-64 md:border-b-0 md:border-r"
  >
    <div class="flex h-15 items-center justify-between gap-3 px-4 md:h-auto md:block md:p-4">
      <h2 class="flex min-w-0 items-center gap-2 text-sm font-semibold text-snow md:mb-4 md:px-2">
        <Icon name="material-symbols:globe" size="1.25rem" class="shrink-0 text-primary" />
        <span class="hidden md:inline">Hack Club DNS</span>
        <span class="truncate md:hidden">{{ bareDomain(selectedDomain) }}</span>
      </h2>

      <button
        type="button"
        class="flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-dark px-3 text-sm font-medium text-snow md:hidden"
        :aria-expanded="mobileOpen"
        aria-controls="mobile-domain-menu"
        @click="mobileOpen = !mobileOpen"
      >
        Switch domain
        <Icon
          name="material-symbols:keyboard-arrow-down-rounded"
          size="1.2rem"
          class="transition-transform"
          :class="{ 'rotate-180': mobileOpen }"
        />
      </button>
    </div>

    <nav
      id="mobile-domain-menu"
      aria-label="Domains"
      class="domain-menu absolute top-full right-0 left-0 max-h-[min(70dvh,32rem)] space-y-4 overflow-y-auto border-t border-border bg-black p-4 shadow-2xl md:static md:max-h-none md:border-0 md:p-4 md:pt-0 md:shadow-none"
      :class="{ 'domain-menu--open': mobileOpen }"
    >
      <div v-for="sec in sections" :key="sec.title">
        <p class="mb-1 px-2 text-xs font-medium tracking-wide text-muted uppercase">
          {{ sec.title }}
        </p>
        <div class="space-y-px">
          <button
            v-for="d in sec.items"
            :key="d"
            type="button"
            class="min-h-10 w-full rounded-md px-2 py-2 text-left text-sm transition-colors md:min-h-0 md:py-1.5"
            :class="btnClass(d)"
            @click="selectDomain(d)"
          >
            <span class="line-clamp-1">{{ bareDomain(d) }}</span>
          </button>
        </div>
      </div>
      <p class="mt-6 px-2 text-xs text-muted">
        Made by
        <a href="https://3kh0.net" target="_blank" rel="noreferrer" class="text-primary">3kh0</a>
      </p>
    </nav>
  </aside>
</template>
