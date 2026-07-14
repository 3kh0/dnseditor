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
    class="w-full shrink-0 border-b border-border bg-black p-4 md:w-64 md:border-b-0 md:border-r"
  >
    <h2 class="mb-4 flex items-center gap-2 px-2 text-sm font-semibold text-snow">
      <Icon name="material-symbols:globe" size="1.25rem" class="text-primary" />
      Hack Club DNS
    </h2>

    <nav aria-label="Domains" class="space-y-4">
      <div>
        <p class="mb-1 px-2 text-xs font-medium tracking-wide text-muted uppercase">Pinned</p>
        <div class="space-y-px">
          <button
            v-for="domain in pinned"
            :key="domain"
            type="button"
            class="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            :class="
              selectedDomain === domain
                ? 'bg-darkless font-medium text-snow'
                : 'text-muted hover:bg-darkless/60 hover:text-snow'
            "
            @click="emit('selectDomain', domain)"
          >
            <span class="line-clamp-1">{{ labelFor(domain) }}</span>
          </button>
        </div>
      </div>

      <div>
        <p class="mb-1 px-2 text-xs font-medium tracking-wide text-muted uppercase">All domains</p>
        <div class="space-y-px">
          <button
            v-for="domain in domainFiles"
            :key="domain"
            type="button"
            class="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            :class="
              selectedDomain === domain
                ? 'bg-darkless font-medium text-snow'
                : 'text-muted hover:bg-darkless/60 hover:text-snow'
            "
            @click="emit('selectDomain', domain)"
          >
            <span class="line-clamp-1">{{ labelFor(domain) }}</span>
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
