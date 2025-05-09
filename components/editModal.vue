<template>
  <div>
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        class="absolute inset-0 bg-darker/80 backdrop-blur-[3px]"
        @click="close"
      ></div>

      <!--<div
        class="relative bg-darkless p-6 rounded-xl shadow-xl max-w-lg w-full mx-4 border border-border/20"
      >
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold text-primary flex items-center gap-2">
            <Icon name="material-symbols:ink-pen-rounded" />
            Edit DNS Records
          </h2>
          <button
            class="text-muted hover:text-snow transition-colors"
            @click="close"
          >
            <Icon name="material-symbols:close-rounded" size="1.5rem" />
          </button>
        </div>

        <div
          v-if="sending"
          class="absolute inset-0 bg-darkless/80 backdrop-blur-sm flex items-center justify-center"
        >
          <div class="text-primary flex flex-col items-center gap-3">
            <Icon name="codex:loader" size="3em" class="animate-spin" />
            <span>Submitting record...</span>
          </div>
        </div>

        <div
          v-if="domain !== 'dino.icu.yaml'"
          class="mb-6 p-4 bg-yellow/10 border border-yellow/20 rounded-lg text-yellow flex gap-2"
        >
          <Icon name="material-symbols:warning" class="shrink-0 mt-0.5" />
          <div class="text-sm text-semibold">
            Hold up! You are trying to edit a domain which requires approval
            from HQ on any changes! Please make sure before making your changes
            you get the go ahead from HQ. If you have the green light already,
            then go ahead and make your changes!
          </div>
        </div>

        <div v-if="!mode" class="space-y-4">
          <button
            class="w-full p-4 rounded-lg border border-border/20 hover:bg-primary/10 transition-colors"
            @click="mode = 'add'"
          >
            <div class="font-semibold text-primary">Add New Record</div>
            <div class="text-sm text-muted">
              Create a new DNS record for this domain
            </div>
          </button>

          <button
            class="w-full p-4 rounded-lg border border-border/20 hover:bg-primary/10 transition-colors"
            @click="mode = 'edit'"
          >
            <div class="font-semibold text-primary">Edit Existing Record</div>
            <div class="text-sm text-muted">Modify an existing DNS record</div>
          </button>
        </div>

        <div v-else-if="mode === 'add'" class="space-y-4">
          <div>
            <label class="block text-sm text-muted mb-1">Subdomain</label>
            <input
              v-model="form.subdomain"
              type="text"
              class="w-full bg-darker/50 border border-border/20 rounded-lg px-4 py-2 text-white"
              placeholder="coolsubdomain"
            />
          </div>

          <div>
            <label class="block text-sm text-muted mb-1">Record Type</label>
            <select
              v-model="form.type"
              class="w-full bg-darker/50 border border-border/20 rounded-lg px-4 py-2 text-white"
            >
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="MX">MX</option>
              <option value="TXT">TXT</option>
            </select>
          </div>

          <div>
            <label class="block text-sm text-muted mb-1">Value</label>
            <input
              v-model="form.value"
              type="text"
              class="w-full bg-darker/50 border border-border/20 rounded-lg px-4 py-2 text-white"
            />
          </div>

          <div>
            <label class="block text-sm text-muted mb-1">TTL</label>
            <input
              v-model="form.ttl"
              type="number"
              class="w-full bg-darker/50 border border-border/20 rounded-lg px-4 py-2 text-white"
              placeholder="600"
            />
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <button
              class="px-4 py-2 rounded-lg text-white hover:bg-darker/80 transition-colors"
              @click="back"
              :disabled="sending"
            >
              Back
            </button>
            <button
              class="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/80 transition-colors disabled:opacity-50"
              @click="submit"
              :disabled="sending || !isValid"
            >
              Add Record
            </button>
          </div>

          <div
            v-if="error"
            class="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm"
          >
            {{ error }}
          </div>
        </div>
      </div>-->

      <div
        class="relative bg-darkless p-6 rounded-xl shadow-xl max-w-lg w-full mx-4 border border-border/20"
      >
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold text-primary flex items-center gap-2">
            <Icon name="material-symbols:ink-pen-rounded" />
            Edit DNS Records
          </h2>
          <button
            class="text-muted hover:text-snow transition-colors"
            @click="close"
          >
            <Icon name="material-symbols:close-rounded" size="1.5rem" />
          </button>
        </div>
        <div class="rounded-lg text-secondary flex gap-2">
          <div class="text-sm text-semibold">
            Sorry, but this feature was never shipped to due to wonky yaml
            files. Many attempts were made to fix this issue, all failed due to
            others not liking the idea, for now this tool will remain as a cool
            way to view and explore the Hack Club DNS records. The pull request
            involved can be viewed here:
            <a
              href="https://github.com/hackclub/dns/pull/1696"
              class="text-primary hover:text-primary/80 transition-colors"
              >hackclub/dns#1696</a
            >.
          </div>
        </div>
      </div>
    </div>
    <Success :show="showSuccess" :pr-url="prUrl" @close="goodEnding" />
  </div>
</template>

<script setup>
const props = defineProps({
  show: Boolean,
  domain: String,
});

const emit = defineEmits(["close", "submit"]);
const mode = ref(null);
const error = ref(null);
const sending = ref(false);
const showSuccess = ref(false);
const prUrl = ref("");

const form = ref({
  // default form values based on the many records already in the file
  subdomain: "",
  type: "A",
  value: "",
  ttl: 600,
});

// vibe check form
const isValid = computed(() => {
  return (
    form.value.subdomain &&
    form.value.type &&
    form.value.value &&
    form.value.ttl > 0
  );
});

const close = () => {
  mode.value = null;
  error.value = null;
  form.value = {
    subdomain: "",
    type: "A",
    value: "",
    ttl: 600,
  };
  emit("close");
};

const back = () => {
  mode.value = null;
  error.value = null;
};

const submit = async () => {
  try {
    error.value = null;
    sending.value = true;

    const response = await fetch("/api/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domain: props.domain,
        record: form.value,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "failed to submit record");
    }

    const data = await response.json();
    emit("submit", form.value);
    close();
    prUrl.value = data.prUrl;
    showSuccess.value = true;
  } catch (err) {
    error.value = err.message;
  } finally {
    sending.value = false;
  }
};

const goodEnding = () => {
  showSuccess.value = false;
};
</script>
