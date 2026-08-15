<script setup lang="ts">
const props = defineProps<{
  show: boolean;
  labelledby: string;
  panelClass: string;
  zClass: string;
}>();

const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);

defineExpose({
  scrollTo: (options?: ScrollToOptions) => panel.value?.scrollTo(options),
});
</script>

<template>
  <Transition name="dialog" appear>
    <div
      v-if="props.show"
      class="fixed inset-0 flex items-end justify-center sm:items-center"
      :class="props.zClass"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="props.labelledby"
      @keydown.esc="emit('close')"
    >
      <button
        type="button"
        class="dialog-backdrop absolute inset-0 bg-darker/80 backdrop-blur-[3px]"
        aria-label="Close dialog"
        @click="emit('close')"
      />

      <div ref="panel" class="dialog-panel" :class="props.panelClass">
        <slot />
      </div>
    </div>
  </Transition>
</template>
