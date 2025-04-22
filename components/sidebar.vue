<template>
  <aside
    class="w-full md:w-72 bg-darkless/40 backdrop-blur-xl p-6 border-r border-border/20 shadow-xl"
  >
    <h2 class="text-xl font-bold mb-6 text-primary flex items-center gap-2">
      <Icon name="material-symbols:globe" size="1.5rem" />
      Hack Club DNS
    </h2>
    <div class="space-y-4">
      <div>
        <p class="text-xs text-muted mb-2 px-4">📌 Pinned</p>
        <div class="space-y-1">
          <button
            v-for="domain in pinned"
            :key="domain"
            class="w-full text-left px-4 py-3 rounded-lg transition-all duration-300 hover:scale-102 group"
            :class="{
              'bg-primary/20 text-primary border border-primary/20':
                selectedDomain === domain,
              'hover:bg-darkless/80': selectedDomain !== domain,
            }"
            @click="$emit('select-domain', domain)"
          >
            <span class="line-clamp-1">{{ domain.replace(".yaml", "") }}</span>
          </button>
        </div>
      </div>

      <div>
        <p class="text-xs text-muted mb-2 px-4">All domains</p>
        <div class="space-y-1">
          <button
            v-for="(domain, index) in domainFiles"
            :key="index"
            class="w-full text-left px-4 py-3 rounded-lg transition-all duration-300 hover:scale-102 group"
            :class="{
              'bg-primary/20 text-primary border border-primary/20':
                selectedDomain === domain,
              'hover:bg-darkless/80': selectedDomain !== domain,
            }"
            @click="$emit('select-domain', domain)"
          >
            <span class="line-clamp-1">{{ domain.replace(".yaml", "") }}</span>
          </button>
        </div>
      </div>
    </div>
    <p class="text-sm text-muted mt-4">
      Made by
      <a href="https://3kh0.net" target="_blank" class="text-primary">3kh0</a>
    </p>
  </aside>
</template>

<script setup>
const props = defineProps({
  domainFiles: {
    type: Array,
    required: true,
  },
  selectedDomain: {
    type: String,
    required: true,
  },
});

// Define pinned domains
const PINNED_DOMAINS = ["hackclub.com.yaml", "dino.icu.yaml"];

// Computed properties to split domains into pinned and unpinned
const pinned = computed(() =>
  props.domainFiles.filter((domain) => PINNED_DOMAINS.includes(domain))
);

defineEmits(["select-domain"]);
</script>
