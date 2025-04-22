<template>
  <aside
    class="w-full md:w-72 bg-darkless/40 backdrop-blur-xl p-6 border-r border-border/20 shadow-xl"
  >
    <h2 class="text-xl font-bold mb-6 text-primary flex items-center gap-2">
      <Icon name="material-symbols:globe" size="1.5rem" />
      Hack Club DNS
    </h2>
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
    <p class="text-sm text-muted mt-4">
      Made by
      <a href="https://3kh0.net" target="_blank" class="text-primary">3kh0</a>
    </p>
  </aside>
</template>

<script setup>
defineProps({
  domainFiles: {
    type: Array,
    required: true,
  },
  selectedDomain: {
    type: String,
    required: true,
  },
});

defineEmits(["select-domain"]);
</script>
