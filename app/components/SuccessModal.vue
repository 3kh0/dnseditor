<script setup lang="ts">
defineProps<{
  show: boolean;
  prUrl?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-60 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-title"
      @keydown.esc="emit('close')"
    >
      <button
        type="button"
        class="absolute inset-0 bg-darker/80 backdrop-blur-[3px]"
        aria-label="Close dialog"
        @click="emit('close')"
      />

      <div
        class="relative mx-4 w-full max-w-xl rounded-xl border border-border bg-dark p-6 shadow-2xl"
      >
        <div class="flex flex-col items-center gap-4 text-center">
          <div class="text-green">
            <Icon name="material-symbols:check-circle" size="4em" />
          </div>

          <h3 id="success-title" class="text-xl font-bold text-snow">And that's all done!</h3>

          <p class="text-muted">
            Your DNS record has been submitted for review. Wait for the PR to be approved and
            merged. Once it merges, your changes will be live.
          </p>

          <div class="mt-4 flex gap-2">
            <a
              v-if="prUrl"
              :href="prUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/80"
            >
              View Pull Request
            </a>
            <button
              type="button"
              class="rounded-lg bg-primary/20 px-4 py-2 text-primary transition-colors hover:bg-primary/30"
              @click="emit('close')"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
