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

const bareDomain = computed(() => props.domain.replace(/\.yaml$/, ""));

const previewName = computed(() => {
  const subdomain = form.value.subdomain.trim();
  return subdomain ? `${subdomain}.${bareDomain.value}` : null;
});

const previewValue = computed(() => form.value.value.trim() || null);

const previewVerb = computed(() => {
  if (form.value.type === "MX") return "routes mail through";
  if (form.value.type === "TXT") return "has a TXT record with content";
  return "points to";
});

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
        class="relative mx-4 w-full max-w-2xl rounded-xl border border-border bg-dark p-6 shadow-2xl"
      >
        <div
          v-if="sending"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-dark/80 backdrop-blur-sm"
        >
          <div class="flex flex-col items-center gap-3 text-primary">
            <Icon name="material-symbols:progress-activity" size="3em" class="animate-spin" />
            <span class="text-sm text-snow">Submitting record...</span>
          </div>
        </div>

        <div class="mb-5 flex items-center justify-between">
          <h2 id="edit-record-title" class="text-2xl font-semibold text-snow">Add record</h2>
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-muted hover:text-snow"
            aria-label="Close dialog"
            @click="close"
          >
            <Icon name="material-symbols:close-rounded" size="1.25rem" />
          </button>
        </div>

        <div
          v-if="needsHqApproval"
          class="mb-5 flex gap-2 rounded-lg border border-yellow/20 bg-yellow/10 p-3 text-yellow"
        >
          <Icon name="material-symbols:warning" class="mt-0.5 shrink-0" size="1rem" />
          <p class="text-sm">
            Hold up! Changes to this domain need HQ approval. Only continue if you already have the
            green light (or you are testing and will close the PR).
          </p>
        </div>

        <div v-if="mode === 'menu'" class="space-y-4">
          <button
            type="button"
            class="w-full rounded-lg border border-border bg-darker p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
            @click="mode = 'add'"
          >
            <div class="text-sm font-medium text-snow">Add new record</div>
            <div class="mt-0.5 text-sm text-muted">Create a new DNS record for this domain</div>
          </button>

          <p class="text-xs text-muted">
            This will create a pull request on
            <code class="text-snow">hackclub/dns</code>. Editing existing records is not supported,
            yet...
          </p>
        </div>

        <form v-else-if="mode === 'add'" class="space-y-5" @submit.prevent="submit">
          <p class="text-lg text-snow">
            <span :class="previewName ? 'text-snow' : 'text-muted'">{{
              previewName ?? "[name]"
            }}</span>
            {{ previewVerb }}
            <span :class="previewValue ? 'text-snow' : 'text-muted'">{{
              previewValue ?? "[value]"
            }}</span>
            via a pull request on hackclub/dns.
          </p>

          <div class="flex gap-3">
            <div class="w-28 shrink-0">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="type">Type</label>
              <select
                id="type"
                v-model="form.type"
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none focus:border-primary"
              >
                <option v-for="type in recordTypes" :key="type" :value="type">{{ type }}</option>
              </select>
            </div>

            <div class="min-w-0 flex-1">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="subdomain">Name</label>
              <input
                id="subdomain"
                v-model="form.subdomain"
                type="text"
                autocomplete="off"
                spellcheck="false"
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none placeholder:text-muted/70 focus:border-primary"
                :placeholder="`coolsubdomain (becomes coolsubdomain.${domain.replace(/\.yaml$/, '')})`"
              />
            </div>
          </div>

          <div class="flex gap-3">
            <div class="min-w-0 flex-1">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="value">
                {{ form.type === "MX" ? "Exchange" : "Value" }}
              </label>
              <input
                id="value"
                v-model="form.value"
                type="text"
                spellcheck="false"
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none placeholder:text-muted/70 focus:border-primary"
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

            <div v-if="form.type === 'MX'" class="w-28 shrink-0">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="mx-preference"
                >Priority</label
              >
              <input
                id="mx-preference"
                v-model.number="form.mxPreference"
                type="number"
                min="0"
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-snow" for="contact">Contact</label>
            <input
              id="contact"
              v-model="form.contact"
              type="text"
              autocomplete="off"
              class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none placeholder:text-muted/70 focus:border-primary"
              placeholder="you@example.com U012AB345CD"
            />
            <p class="mt-1 text-xs text-muted">
              Required by hackclub/dns CI — email and/or Slack member ID.
            </p>
          </div>

          <div class="border-t border-border pt-4">
            <button
              type="button"
              class="flex items-center gap-2 text-sm font-medium text-snow transition-colors hover:text-primary"
              :aria-expanded="showAdvanced"
              @click="showAdvanced = !showAdvanced"
            >
              <Icon
                name="icon-park-outline:down"
                size="0.875rem"
                class="transition-transform"
                :class="{ '-rotate-90': !showAdvanced }"
              />
              Record attributes
            </button>
            <div v-show="showAdvanced" class="mt-3">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="ttl">TTL</label>
              <input
                id="ttl"
                v-model="form.ttl"
                type="number"
                min="1"
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none placeholder:text-muted/70 focus:border-primary"
                placeholder="Leave empty for default"
              />
              <p class="mt-1 text-xs text-muted">Only set this if you need a custom TTL.</p>
            </div>
          </div>

          <div class="flex gap-2 border-t border-border pt-4">
            <button
              type="submit"
              class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/85 disabled:opacity-50"
              :disabled="sending || !isValid"
            >
              Open Pull Request
            </button>
            <button
              type="button"
              class="rounded-lg border border-border px-4 py-2 text-sm text-snow transition-colors hover:bg-darkless disabled:opacity-50"
              :disabled="sending"
              @click="back"
            >
              Back
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
