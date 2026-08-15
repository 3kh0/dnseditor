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
    <AnimatedModal
      :show="show"
      labelledby="success-title"
      z-class="z-60"
      panel-class="relative w-full max-w-xl rounded-t-xl border border-border bg-dark p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:mx-4 sm:rounded-xl sm:p-6"
      @close="emit('close')"
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

        <div class="mt-4 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a
            v-if="prUrl"
            :href="prUrl"
            target="_blank"
            rel="noreferrer"
            class="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-center font-semibold text-white transition-colors hover:bg-primary/80 sm:min-h-0 sm:w-auto"
          >
            {{ needsManualPr ? "Open Pull Request" : "View Pull Request" }}
          </a>
          <button
            type="button"
            class="min-h-11 w-full rounded-lg border border-border px-4 py-2 text-sm text-snow transition-colors hover:bg-darkless sm:min-h-0 sm:w-auto"
            @click="emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </AnimatedModal>
  </Teleport>
</template>
