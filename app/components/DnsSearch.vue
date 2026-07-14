<script setup lang="ts">
const model = defineModel<string>({ required: true });
</script>

<template>
  <label
    class="relative block w-full rounded-lg border border-border/20 bg-darkless/40 py-3 pl-10 pr-4 backdrop-blur-md"
  >
    <span class="sr-only">Search DNS records</span>
    <Icon
      name="material-symbols:search-rounded"
      class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      size="1.5em"
    />
    <input
      v-model="model"
      type="search"
      placeholder="Search for records and values..."
      class="w-full bg-transparent text-snow placeholder-muted/60 outline-none"
    />
  </label>
</template>
