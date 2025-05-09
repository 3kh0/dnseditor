<template>
  <div
    class="relative w-full pl-10 pr-4 py-3 rounded-lg bg-darkless/40 backdrop-blur-md border border-border/20"
  >
    <Icon
      name="material-symbols:search-rounded"
      class="text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
      size="1.5em"
    />
    <input
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      type="text"
      placeholder="Search for records and values..."
      class="w-full bg-transparent text-snow placeholder-muted/60 focus:outline-none transition-all duration-300"
    />
  </div>
</template>

<script setup>
defineProps({
  modelValue: {
    type: String,
    required: true,
  },
});

defineEmits(["update:modelValue"]);
</script>
