<script setup lang="ts">
const props = defineProps<{
  show: boolean;
  domain: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const mode = ref<"menu" | "add" | null>(null);
const error = ref<string | null>(null);
const sending = ref(false);
const showSuccess = ref(false);
const prUrl = ref("");
const showAdvanced = ref(false);

const form = ref({
  subdomain: "",
  type: "CNAME",
  value: "",
  ttl: "" as number | "",
  contact: "",
  mxPreference: 10,
});

const recordTypes = ["A", "AAAA", "CNAME", "ALIAS", "TXT", "MX"] as const;

const needsHqApproval = computed(() => props.domain !== "dino.icu.yaml");

const isValid = computed(() => {
  const subdomain = form.value.subdomain.trim();
  const value = form.value.value.trim();
  const contact = form.value.contact.trim();

  if (!subdomain || !value || !contact) {
    return false;
  }

  if (
    form.value.ttl !== "" &&
    (!(Number(form.value.ttl) > 0) || !Number.isFinite(Number(form.value.ttl)))
  ) {
    return false;
  }

  if (!isValidSubdomain(subdomain)) return false;
  if (!hasContactInfo(contact)) return false;
  if (form.value.type === "MX" && !(Number(form.value.mxPreference) > 0)) return false;

  return true;
});

watch(
  () => props.show,
  (open) => {
    if (open) {
      mode.value = "menu";
      error.value = null;
      showAdvanced.value = false;
    }
  },
);

function isValidSubdomain(value: string) {
  return /^[A-Za-z0-9_]([A-Za-z0-9._-]*[A-Za-z0-9_])?$/.test(value);
}

function hasContactInfo(value: string) {
  const slack = /\b[UW][A-Z0-9]{8,12}\b/.test(value);
  const email = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/.test(value);
  return slack || email;
}

function resetForm() {
  form.value = {
    subdomain: "",
    type: "CNAME",
    value: "",
    ttl: "",
    contact: "",
    mxPreference: 10,
  };
  showAdvanced.value = false;
}

function close() {
  mode.value = null;
  error.value = null;
  resetForm();
  emit("close");
}

function back() {
  mode.value = "menu";
  error.value = null;
}

async function submit() {
  if (!isValid.value || sending.value) return;

  try {
    error.value = null;
    sending.value = true;

    const payload = {
      domain: props.domain,
      record: {
        subdomain: form.value.subdomain.trim().toLowerCase(),
        type: form.value.type,
        value: form.value.value.trim(),
        contact: form.value.contact.trim(),
        ...(form.value.ttl !== "" ? { ttl: Number(form.value.ttl) } : {}),
        ...(form.value.type === "MX" ? { mxPreference: Number(form.value.mxPreference) } : {}),
      },
    };

    const response = await $fetch<{ success: boolean; prUrl: string }>("/api/submit", {
      method: "POST",
      body: payload,
    });

    prUrl.value = response.prUrl;
    close();
    showSuccess.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    sending.value = false;
  }
}

function errorMessage(err: unknown) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  if (err instanceof Error) return err.message;
  return "Failed to submit record";
}

function onSuccessClose() {
  showSuccess.value = false;
  prUrl.value = "";
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-record-title"
      @keydown.esc="close"
    >
      <button
        type="button"
        class="absolute inset-0 bg-darker/80 backdrop-blur-[3px]"
        aria-label="Close dialog"
        @click="close"
      />

      <div
        class="relative mx-4 w-full max-w-lg rounded-xl border border-border/20 bg-darkless p-6 shadow-xl"
      >
        <div
          v-if="sending"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-darkless/80 backdrop-blur-sm"
        >
          <div class="flex flex-col items-center gap-3 text-primary">
            <Icon name="material-symbols:progress-activity" size="3em" class="animate-spin" />
            <span>Submitting record...</span>
          </div>
        </div>

        <div class="mb-6 flex items-center justify-between">
          <h2 id="edit-record-title" class="flex items-center gap-2 text-xl font-bold text-primary">
            <Icon name="material-symbols:ink-pen-rounded" />
            Edit DNS Records
          </h2>
          <button
            type="button"
            class="text-muted transition-colors hover:text-snow"
            aria-label="Close dialog"
            @click="close"
          >
            <Icon name="material-symbols:close-rounded" size="1.5rem" />
          </button>
        </div>

        <div
          v-if="needsHqApproval"
          class="mb-6 flex gap-2 rounded-lg border border-yellow/20 bg-yellow/10 p-4 text-yellow"
        >
          <Icon name="material-symbols:warning" class="mt-0.5 shrink-0" />
          <p class="text-sm">
            Hold up! Changes to this domain need HQ approval. Only continue if you already have the
            green light (or you are testing and will close the PR).
          </p>
        </div>

        <div v-if="mode === 'menu'" class="space-y-4">
          <button
            type="button"
            class="w-full rounded-lg border border-border/20 p-4 text-left transition-colors hover:bg-primary/10"
            @click="mode = 'add'"
          >
            <div class="font-semibold text-primary">Add New Record</div>
            <div class="text-sm text-muted">Create a new DNS record for this domain</div>
          </button>

          <p class="text-xs text-muted">
            This will create a pull request on
            <code class="text-snow">hackclub/dns</code>. Editing existing records is not supported,
            yet...
          </p>
        </div>

        <form v-else-if="mode === 'add'" class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="mb-1 block text-sm text-muted" for="subdomain">Subdomain</label>
            <input
              id="subdomain"
              v-model="form.subdomain"
              type="text"
              autocomplete="off"
              spellcheck="false"
              class="w-full rounded-lg border border-border/20 bg-darker/50 px-4 py-2 text-white"
              placeholder="coolsubdomain"
            />
            <p class="mt-1 text-xs text-muted">
              Becomes
              <span class="text-snow"
                >{{ form.subdomain.trim() || "…" }}.{{ domain.replace(/\.yaml$/, "") }}</span
              >
            </p>
          </div>

          <div>
            <label class="mb-1 block text-sm text-muted" for="contact">Contact</label>
            <input
              id="contact"
              v-model="form.contact"
              type="text"
              autocomplete="off"
              class="w-full rounded-lg border border-border/20 bg-darker/50 px-4 py-2 text-white"
              placeholder="you@example.com U012AB345CD"
            />
            <p class="mt-1 text-xs text-muted">
              Required by hackclub/dns CI — email and/or Slack member ID.
            </p>
          </div>

          <div>
            <label class="mb-1 block text-sm text-muted" for="type">Record Type</label>
            <select
              id="type"
              v-model="form.type"
              class="w-full rounded-lg border border-border/20 bg-darker/50 px-4 py-2 text-white"
            >
              <option v-for="type in recordTypes" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>

          <div v-if="form.type === 'MX'">
            <label class="mb-1 block text-sm text-muted" for="mx-preference">MX Preference</label>
            <input
              id="mx-preference"
              v-model.number="form.mxPreference"
              type="number"
              min="0"
              class="w-full rounded-lg border border-border/20 bg-darker/50 px-4 py-2 text-white"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm text-muted" for="value">
              {{ form.type === "MX" ? "Exchange" : "Value" }}
            </label>
            <input
              id="value"
              v-model="form.value"
              type="text"
              spellcheck="false"
              class="w-full rounded-lg border border-border/20 bg-darker/50 px-4 py-2 text-white"
              :placeholder="
                form.type === 'CNAME' || form.type === 'ALIAS'
                  ? 'cname.vercel-dns.com.'
                  : form.type === 'A'
                    ? '1.2.3.4'
                    : form.type === 'MX'
                      ? 'aspmx.l.google.com.'
                      : 'record value'
              "
            />
          </div>

          <div class="rounded-lg border border-border/10">
            <button
              type="button"
              class="flex w-full items-center justify-between px-3 py-2 text-sm text-muted transition-colors hover:text-snow"
              :aria-expanded="showAdvanced"
              @click="showAdvanced = !showAdvanced"
            >
              <span>Advanced</span>
              <Icon
                name="icon-park-outline:down"
                size="1rem"
                class="transition-transform"
                :class="{ 'rotate-180': showAdvanced }"
              />
            </button>
            <div v-show="showAdvanced" class="space-y-3 border-t border-border/10 px-3 py-3">
              <div>
                <label class="mb-1 block text-sm text-muted" for="ttl">TTL</label>
                <input
                  id="ttl"
                  v-model="form.ttl"
                  type="number"
                  min="1"
                  class="w-full rounded-lg border border-border/20 bg-darker/50 px-4 py-2 text-white"
                  placeholder="Leave empty for default"
                />
                <p class="mt-1 text-xs text-muted">Only set this if you need a custom TTL.</p>
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg px-4 py-2 text-white transition-colors hover:bg-darker/80 disabled:opacity-50"
              :disabled="sending"
              @click="back"
            >
              Back
            </button>
            <button
              type="submit"
              class="rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/80 disabled:opacity-50"
              :disabled="sending || !isValid"
            >
              Open Pull Request
            </button>
          </div>

          <div
            v-if="error"
            class="mt-4 rounded-lg border border-red/20 bg-red/10 p-3 text-sm text-red"
          >
            {{ error }}
          </div>
        </form>
      </div>
    </div>
  </Teleport>

  <SuccessModal :show="showSuccess" :pr-url="prUrl" @close="onSuccessClose" />
</template>
