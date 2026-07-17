<script setup lang="ts">
import { bareDomain, type DomainFile } from "#shared/dns";

const props = defineProps<{
  domainFiles: readonly DomainFile[];
  selectedDomain: DomainFile;
}>();

const emit = defineEmits<{ selectDomain: [domain: DomainFile] }>();

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
</script>

<template>
  <aside
    class="w-full shrink-0 border-b border-border bg-black p-4 md:w-64 md:border-b-0 md:border-r"
  >
    <h2 class="mb-4 flex items-center gap-2 px-2 text-sm font-semibold text-snow">
      <Icon name="material-symbols:globe" size="1.25rem" class="text-primary" />
      Hack Club DNS
    </h2>

    <nav aria-label="Domains" class="space-y-4">
      <div v-for="sec in sections" :key="sec.title">
        <p class="mb-1 px-2 text-xs font-medium tracking-wide text-muted uppercase">
          {{ sec.title }}
        </p>
        <div class="space-y-px">
          <button
            v-for="d in sec.items"
            :key="d"
            type="button"
            class="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            :class="btnClass(d)"
            @click="emit('selectDomain', d)"
          >
            <span class="line-clamp-1">{{ bareDomain(d) }}</span>
          </button>
        </div>
      </div>
    </nav>

    <p class="mt-6 px-2 text-xs text-muted">
      Made by
      <a href="https://3kh0.net" target="_blank" rel="noreferrer" class="text-primary">3kh0</a>
    </p>
  </aside>
</template>
