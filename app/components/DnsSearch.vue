<script setup lang="ts">
const model = defineModel<string>({ required: true });
</script>

<template>
  <label
    class="relative block min-h-11 w-full rounded-lg border border-border bg-dark py-2.5 pr-10 pl-10 transition-colors focus-within:border-primary sm:min-h-0 sm:py-2 sm:pr-3 sm:pl-9"
  >
    <span class="sr-only">Search DNS records</span>
    <Icon
      name="material-symbols:search-rounded"
      class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted sm:left-2.5"
      size="1.25em"
    />
    <input
      v-model="model"
      type="search"
      placeholder="Search names, types, or values"
      enterkeyhint="search"
      class="w-full bg-transparent text-base text-snow outline-none placeholder:text-muted/70 sm:text-sm"
    />
    <Transition name="fade">
      <button
        v-if="model"
        type="button"
        class="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-snow"
        aria-label="Clear search"
        @click="model = ''"
      >
        <Icon name="material-symbols:close-rounded" size="1.1rem" />
      </button>
    </Transition>
  </label>
</template>
