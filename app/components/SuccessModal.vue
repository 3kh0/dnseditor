<script setup lang="ts">
defineProps<{
  show: boolean;
  prUrl?: string;
  needsManualPr?: boolean;
  viaApp?: string | null;
}>();

const emit = defineEmits<{ close: [] }>();
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

          <h3 id="success-title" class="text-xl font-bold text-snow">
            {{ needsManualPr ? "Almost there!" : "And that's all done!" }}
          </h3>

          <p class="text-muted">
            <template v-if="needsManualPr">
              Your changes are on a branch in your fork. Open the pull request on GitHub to finish
              submitting it for review. Opening in the browser will not show the GitHub App badge —
              only API-opened PRs do.
            </template>
            <template v-else>
              Your DNS record has been submitted for review. Wait for the PR to be approved and
              merged. Once it merges, your changes will be live.
            </template>
          </p>

          <p v-if="viaApp && !needsManualPr" class="text-xs text-muted">
            Opened as you
            <span class="text-snow">with {{ viaApp }}</span>
            (native GitHub App attribution).
          </p>

          <div class="mt-4 flex gap-2">
            <a
              v-if="prUrl"
              :href="prUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/80"
            >
              {{ needsManualPr ? "Open Pull Request on GitHub" : "View Pull Request" }}
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
