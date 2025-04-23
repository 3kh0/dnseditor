<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[60] flex items-center justify-center"
  >
    <div
      class="absolute inset-0 bg-darker/80 backdrop-blur-[3px]"
      @click="$emit('close')"
    ></div>

    <div
      class="relative bg-darkless p-6 rounded-xl shadow-xl max-w-xl w-full mx-4 border border-border/20"
    >
      <div class="flex flex-col items-center text-center gap-4">
        <div class="text-green-500">
          <Icon name="material-symbols:check-circle" size="4em" />
        </div>

        <h3 class="text-xl font-bold text-snow">And that's all done!</h3>

        <p class="text-muted">
          Your pull request with your changes will opened shortly, check your
          GitHub notifications for the PR. The next step is to wait for the PR
          to be approved and merged. Once the PR is merged, your changes will be
          live.
        </p>

        <div class="flex gap-2 mt-4">
          <button
            class="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/80 transition-colors"
            @click="$emit('close')"
          >
            Yippee!
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  show: Boolean,
});

defineEmits(["close"]);
</script>
