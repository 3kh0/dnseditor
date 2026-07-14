<script setup lang="ts">
defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-notice-title"
      @keydown.esc="emit('close')"
    >
      <button
        type="button"
        class="absolute inset-0 bg-darker/80 backdrop-blur-[3px]"
        aria-label="Close dialog"
        @click="emit('close')"
      />

      <div
        class="relative mx-4 w-full max-w-lg rounded-xl border border-border/20 bg-darkless p-6 shadow-xl"
      >
        <div class="mb-6 flex items-center justify-between">
          <h2 id="edit-notice-title" class="flex items-center gap-2 text-xl font-bold text-primary">
            <Icon name="material-symbols:ink-pen-rounded" />
            Edit DNS Records
          </h2>
          <button
            type="button"
            class="text-muted transition-colors hover:text-snow"
            aria-label="Close dialog"
            @click="emit('close')"
          >
            <Icon name="material-symbols:close-rounded" size="1.5rem" />
          </button>
        </div>

        <p class="text-sm text-secondary">
          Sorry, but this feature was never shipped due to inconsistent YAML files. For now, this
          tool remains a way to view and explore the Hack Club DNS records. The related pull request
          is
          <a
            href="https://github.com/hackclub/dns/pull/1696"
            target="_blank"
            rel="noreferrer"
            class="text-primary transition-colors hover:text-primary/80"
            >hackclub/dns#1696</a
          >.
        </p>
      </div>
    </div>
  </Teleport>
</template>
