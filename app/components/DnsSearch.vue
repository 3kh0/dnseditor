<script setup lang="ts">
const model = defineModel<string>({ required: true });
</script>

<template>
  <label
    class="relative block w-full rounded-lg border border-border bg-dark py-2 pr-3 pl-9 transition-colors focus-within:border-primary"
  >
    <span class="sr-only">Search DNS records</span>
    <Icon
      name="material-symbols:search-rounded"
      class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
      size="1.25em"
    />
    <input
      v-model="model"
      type="search"
      placeholder="Search DNS Records"
      class="w-full bg-transparent text-sm text-snow outline-none placeholder:text-muted/70"
    />
  </label>
</template>
