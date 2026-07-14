<script setup lang="ts">
import type { DomainFile } from "#shared/dns";

const props = defineProps<{
  domainFiles: readonly DomainFile[];
  selectedDomain: DomainFile;
}>();

const emit = defineEmits<{
  selectDomain: [domain: DomainFile];
}>();

const pinnedDomains: readonly DomainFile[] = ["hackclub.com.yaml", "dino.icu.yaml"];

const pinned = computed(() => props.domainFiles.filter((domain) => pinnedDomains.includes(domain)));

function labelFor(domain: DomainFile) {
  return domain.replace(/\.yaml$/, "");
}
</script>

<template>
  <aside
    class="w-full shrink-0 border-b border-border/20 bg-darkless/40 p-6 shadow-xl backdrop-blur-xl md:w-72 md:border-b-0 md:border-r"
  >
    <h2 class="mb-6 flex items-center gap-2 text-xl font-bold text-primary">
      <Icon name="material-symbols:globe" size="1.5rem" />
      Hack Club DNS
    </h2>

    <nav aria-label="Domains" class="space-y-4">
      <div>
        <p class="mb-2 px-4 text-xs text-muted">📌 Pinned</p>
        <div class="space-y-1">
          <button
            v-for="domain in pinned"
            :key="domain"
            type="button"
            class="w-full rounded-lg px-4 py-3 text-left transition-colors"
            :class="
              selectedDomain === domain
                ? 'border border-primary/20 bg-primary/20 text-primary'
                : 'hover:bg-darkless/80'
            "
            @click="emit('selectDomain', domain)"
          >
            <span class="line-clamp-1">{{ labelFor(domain) }}</span>
          </button>
        </div>
      </div>

      <div>
        <p class="mb-2 px-4 text-xs text-muted">All domains</p>
        <div class="space-y-1">
          <button
            v-for="domain in domainFiles"
            :key="domain"
            type="button"
            class="w-full rounded-lg px-4 py-3 text-left transition-colors"
            :class="
              selectedDomain === domain
                ? 'border border-primary/20 bg-primary/20 text-primary'
                : 'hover:bg-darkless/80'
            "
            @click="emit('selectDomain', domain)"
          >
            <span class="line-clamp-1">{{ labelFor(domain) }}</span>
          </button>
        </div>
      </div>
    </nav>

    <p class="mt-4 text-sm text-muted">
      Made by
      <a href="https://3kh0.net" target="_blank" rel="noreferrer" class="text-primary">3kh0</a>
    </p>
  </aside>
</template>
