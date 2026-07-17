<script setup lang="ts">
import { bareDomain, hasContact, isSubdomain, supportsCfProxy } from "#shared/dns";

const props = defineProps<{ show: boolean; domain: string }>();
const emit = defineEmits<{ close: [] }>();

const {
  authenticated,
  user,
  fork,
  upstream,
  installUrl,
  manualForkUrl,
  pending: authPending,
  login,
  refresh,
} = useAuth();

const CONTACT_KEY = "dnseditor:contact";

const mode = ref<"menu" | "add" | null>(null);
const error = ref<string | null>(null);
const sending = ref(false);
const showSuccess = ref(false);
const prUrl = ref("");
const needsManualPr = ref(false);
const viaApp = ref<string | null>(null);
const showAdvanced = ref(false);
const refreshingFork = ref(false);
const statusMessage = ref<string | null>(null);

const form = ref({
  subdomain: "",
  type: "CNAME",
  value: "",
  ttl: "" as number | "",
  contact: "",
  mxPreference: 10,
  proxied: false,
});

const recordTypes = ["A", "AAAA", "CNAME", "ALIAS", "TXT", "MX"] as const;

const cnamePresets = [
  {
    id: "coolify-a",
    label: "Coolify A",
    value: "a.selfhosted.hackclub.com.",
    icon: "coolify-a" as const,
  },
  {
    id: "coolify-b",
    label: "Coolify B",
    value: "b.selfhosted.hackclub.com.",
    icon: "coolify-b" as const,
  },
  {
    id: "orchard",
    label: "Orchard",
    value: "a.ingress.tier2.infra.hackclub.com.",
    icon: "orchard" as const,
  },
  { id: "vercel", label: "Vercel", value: "cname.vercel-dns.com.", icon: "vercel" as const },
] as const;

const needsHqApproval = computed(() => props.domain !== "dino.icu.yaml");
const bare = computed(() => bareDomain(props.domain));
const canProxy = computed(() => supportsCfProxy(props.domain, form.value.type));
const showProxyToggle = computed(() => supportsCfProxy(props.domain));
const upstreamLabel = computed(
  () =>
    upstream.value?.fullName ||
    `${upstream.value?.owner || "hackclub"}/${upstream.value?.repo || "dns"}`,
);

const previewName = computed(() => {
  const s = form.value.subdomain.trim();
  return s ? `${s}.${bare.value}` : null;
});
const previewValue = computed(() => form.value.value.trim() || null);
const previewVerb = computed(() =>
  form.value.type === "MX"
    ? "routes mail through"
    : form.value.type === "TXT"
      ? "has a TXT record with content"
      : "points to",
);
const proxySuffix = computed(() =>
  form.value.proxied && canProxy.value ? " and has its traffic proxied through Cloudflare" : "",
);

// Drop proxy when type is not proxyable (MX/TXT/ALIAS).
watch(
  () => form.value.type,
  (type) => {
    if (!supportsCfProxy(props.domain, type)) form.value.proxied = false;
  },
);

const isValid = computed(() => {
  const { subdomain, value, contact, ttl, type, mxPreference } = form.value;
  const s = subdomain.trim();
  const v = value.trim();
  const c = contact.trim();
  if (!s || !v || !c) return false;
  if (ttl !== "" && (!(Number(ttl) > 0) || !Number.isFinite(Number(ttl)))) return false;
  if (!isSubdomain(s) || !hasContact(c)) return false;
  if (type === "MX" && !(Number(mxPreference) > 0)) return false;
  return true;
});

const needsManualFork = computed(() => authenticated.value && !authPending.value && !fork.value);
const canSubmit = computed(
  () =>
    isValid.value && !sending.value && !refreshingFork.value && authenticated.value && !!fork.value,
);

const defaultManualForkUrl = computed(
  () => manualForkUrl.value || `https://github.com/${upstreamLabel.value}/fork`,
);

watch(
  () => props.show,
  async (open) => {
    if (!open) return;
    mode.value = "menu";
    error.value = null;
    statusMessage.value = null;
    showAdvanced.value = false;
    if (!form.value.contact.trim()) form.value.contact = loadContact();
    await refresh();
  },
);

function loadContact(): string {
  if (!import.meta.client) return "";
  try {
    return localStorage.getItem(CONTACT_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function saveContact(c: string) {
  if (!import.meta.client) return;
  try {
    localStorage.setItem(CONTACT_KEY, c);
  } catch {
    /* ignore */
  }
}

function resetForm() {
  form.value = {
    subdomain: "",
    type: "CNAME",
    value: "",
    ttl: "",
    contact: loadContact(),
    mxPreference: 10,
    proxied: false,
  };
  showAdvanced.value = false;
  statusMessage.value = null;
}

const applyCnamePreset = (v: string) => {
  form.value.type = "CNAME";
  form.value.value = v;
};

const isCnamePresetActive = (v: string) => {
  const cur = form.value.value.trim().replace(/\.$/, "").toLowerCase();
  const preset = v.trim().replace(/\.$/, "").toLowerCase();
  return form.value.type === "CNAME" && cur === preset;
};

function close() {
  mode.value = null;
  error.value = null;
  resetForm();
  emit("close");
}

function back() {
  mode.value = "menu";
  error.value = null;
  statusMessage.value = null;
}

const startLogin = () => login(`/?openAdd=1&domain=${encodeURIComponent(props.domain)}`);

async function refreshAfterManualFork() {
  error.value = null;
  statusMessage.value = "Looking for your fork…";
  refreshingFork.value = true;
  try {
    await refresh();
    if (fork.value) {
      statusMessage.value = `Found fork ${fork.value.fullName}`;
    } else {
      statusMessage.value = null;
      error.value = `Still no fork of ${upstreamLabel.value} on your account. Fork it on GitHub, wait a few seconds, then try again.`;
    }
  } finally {
    refreshingFork.value = false;
  }
}

async function submit() {
  if (!canSubmit.value) return;

  try {
    error.value = null;
    sending.value = true;
    statusMessage.value = `Opening PR via ${fork.value!.fullName}…`;

    const response = await $fetch<{
      success: boolean;
      prUrl: string;
      needsManualPr?: boolean;
      viaApp?: string | null;
    }>("/api/submit", {
      method: "POST",
      body: {
        domain: props.domain,
        record: {
          subdomain: form.value.subdomain.trim().toLowerCase(),
          type: form.value.type,
          value: form.value.value.trim(),
          contact: form.value.contact.trim(),
          ...(form.value.ttl !== "" && !(form.value.proxied && canProxy.value)
            ? { ttl: Number(form.value.ttl) }
            : {}),
          ...(form.value.type === "MX" ? { mxPreference: Number(form.value.mxPreference) } : {}),
          ...(form.value.proxied && canProxy.value ? { proxied: true } : {}),
        },
      },
    });

    prUrl.value = response.prUrl;
    needsManualPr.value = response.needsManualPr === true;
    viaApp.value = response.viaApp ?? null;
    saveContact(form.value.contact.trim());
    close();
    showSuccess.value = true;
    await refresh();
  } catch (err) {
    const code = errCode(err);
    error.value =
      code === "AUTH_REQUIRED"
        ? "Sign in with GitHub to open a pull request."
        : code === "INVALID_TOKEN_TYPE"
          ? "Your session is not a GitHub App user token (ghu_). Sign out and sign in again with the GitHub App."
          : code === "FORK_REQUIRED"
            ? `You need a fork of ${upstreamLabel.value} on your account first.`
            : errMsg(err);
    statusMessage.value = null;
  } finally {
    sending.value = false;
  }
}

function errCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: { data?: { code?: string }; code?: string } }).data;
  return data?.data?.code || data?.code || null;
}

function errMsg(err: unknown) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return err instanceof Error ? err.message : "Failed to submit record";
}

function onSuccessClose() {
  showSuccess.value = false;
  prUrl.value = "";
  needsManualPr.value = false;
  viaApp.value = null;
}

const valuePlaceholder = computed(() => {
  const t = form.value.type;
  if (t === "CNAME" || t === "ALIAS") return "cname.vercel-dns.com.";
  if (t === "A") return "1.2.3.4";
  if (t === "MX") return "aspmx.l.google.com.";
  return "record value";
});
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
        class="relative mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-dark p-6 shadow-2xl"
      >
        <div
          v-if="sending || refreshingFork"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-dark/80 backdrop-blur-sm"
        >
          <div class="flex flex-col items-center gap-3 px-4 text-center text-primary">
            <Icon name="material-symbols:progress-activity" size="3em" class="animate-spin" />
            <span class="text-sm text-snow">{{ statusMessage || "Working…" }}</span>
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
            This opens a pull request to
            <code class="text-snow">{{ upstreamLabel }}</code>
            from a branch on
            <strong class="font-medium text-snow">your fork</strong>
            so we don't add temporary branches on the main repo. Editing existing records is not
            supported yet.
          </p>
        </div>

        <form v-else-if="mode === 'add'" class="space-y-5" @submit.prevent="submit">
          <div class="rounded-lg border border-border bg-darker p-3 text-sm">
            <template v-if="authPending">
              <p class="text-muted">Checking GitHub sign-in…</p>
            </template>

            <template v-else-if="!authenticated">
              <p class="text-snow">
                Sign in with GitHub so the pull request is opened as
                <strong class="font-medium">you</strong>.
              </p>
              <button
                type="button"
                class="mt-3 flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/85"
                @click="startLogin"
              >
                <Icon name="simple-icons:github" size="1rem" />
                Sign in with GitHub
              </button>
            </template>

            <template v-else>
              <div class="flex items-start gap-2">
                <img
                  v-if="user?.avatarUrl"
                  :src="user.avatarUrl"
                  :alt="user.login"
                  class="mt-0.5 size-7 rounded-full"
                  width="28"
                  height="28"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-snow">
                    Signed in as
                    <strong class="font-medium">@{{ user?.login }}</strong>
                  </p>

                  <p v-if="fork" class="mt-1 text-muted">
                    Using your fork
                    <a
                      :href="fork.htmlUrl"
                      target="_blank"
                      rel="noreferrer"
                      class="text-primary underline-offset-2 hover:underline"
                    >
                      {{ fork.fullName }}
                    </a>
                    → PR to
                    <code class="text-snow">{{ upstreamLabel }}</code>
                  </p>

                  <div v-else-if="needsManualFork" class="mt-2 space-y-3">
                    <p class="text-muted">
                      We need a fork of
                      <code class="text-snow">{{ upstreamLabel }}</code>
                      under your account. Fork it on GitHub (one click), then come back here.
                    </p>
                    <div class="flex flex-wrap gap-2">
                      <a
                        :href="defaultManualForkUrl"
                        target="_blank"
                        rel="noreferrer"
                        class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/85"
                      >
                        Fork on GitHub
                      </a>
                      <button
                        type="button"
                        class="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm text-snow transition-colors hover:bg-darkless"
                        :disabled="refreshingFork"
                        @click="refreshAfterManualFork"
                      >
                        I forked it — refresh
                      </button>
                    </div>
                    <p v-if="installUrl" class="text-xs text-muted">
                      After forking, if submit fails with a permission error, also
                      <a
                        :href="installUrl"
                        target="_blank"
                        rel="noreferrer"
                        class="text-primary underline-offset-2 hover:underline"
                      >
                        install the app
                      </a>
                      on your account so it can push branches to your fork.
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <p class="text-lg text-snow">
            <span :class="previewName ? 'text-snow' : 'text-muted'">{{
              previewName ?? "[name]"
            }}</span>
            {{ previewVerb }}
            <span :class="previewValue ? 'text-snow' : 'text-muted'">{{
              previewValue ?? "[value]"
            }}</span
            >{{ proxySuffix }} via a pull request on {{ upstreamLabel }}.
          </p>

          <div class="flex gap-3">
            <div class="w-28 shrink-0">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="type">Type</label>
              <select
                id="type"
                v-model="form.type"
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none focus:border-primary"
              >
                <option v-for="t in recordTypes" :key="t" :value="t">{{ t }}</option>
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
                :placeholder="`coolsubdomain (becomes coolsubdomain.${bare})`"
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
                :placeholder="valuePlaceholder"
              />

              <div
                v-if="form.type === 'CNAME'"
                class="mt-2 flex flex-wrap gap-1.5"
                role="group"
                aria-label="Common CNAME targets"
              >
                <button
                  v-for="preset in cnamePresets"
                  :key="preset.id"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                  :class="
                    isCnamePresetActive(preset.value)
                      ? 'border-primary bg-primary/15 text-snow'
                      : 'border-border bg-darker text-muted hover:border-muted hover:text-snow'
                  "
                  :title="preset.value"
                  @click="applyCnamePreset(preset.value)"
                >
                  <span
                    v-if="preset.icon === 'coolify-a' || preset.icon === 'coolify-b'"
                    class="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[10px] font-bold leading-none text-primary"
                    aria-hidden="true"
                  >
                    {{ preset.icon === "coolify-a" ? "A" : "B" }}
                  </span>

                  <svg
                    v-else-if="preset.icon === 'orchard'"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 56 56"
                    fill="none"
                    class="size-4 shrink-0"
                    aria-hidden="true"
                  >
                    <g clip-path="url(#orchard-chip-clip)">
                      <path
                        d="M48.8019 20.4288C46.7765 14.8642 40.7529 11.9111 35.1561 13.6324C34.9754 13.688 34.7949 13.748 34.6152 13.8134C34.5498 13.6337 34.4798 13.4569 34.4062 13.2827C32.1273 7.88889 25.9932 5.17271 20.4286 7.19806C14.8639 9.22341 11.9109 15.247 13.6322 20.8438C13.6877 21.0246 13.7478 21.205 13.8132 21.3847C13.6335 21.4501 13.4567 21.5201 13.2825 21.5937C7.88868 23.8727 5.1725 30.0068 7.19785 35.5714C9.28861 41.3157 15.6402 44.2775 21.3845 42.1867C23.4753 47.9311 29.8269 50.8929 35.5712 48.8021C41.3155 46.7113 44.2773 40.3597 42.1865 34.6154C47.9309 32.5247 50.8926 26.1731 48.8019 20.4288ZM29.8927 33.2006C30.4243 33.0071 30.9663 32.9008 31.5033 32.8732C32.8728 33.962 34.4855 34.7137 36.1998 35.0632C36.5243 35.4926 36.7923 35.9761 36.986 36.5083C38.0314 39.3804 36.5505 42.5562 33.6784 43.6016C30.8062 44.647 27.6304 43.1661 26.585 40.2939C26.3914 39.7619 26.2847 39.2195 26.2572 38.6821C27.346 37.3124 28.0979 35.7001 28.4472 33.9855C28.8765 33.6611 29.3607 33.3942 29.8927 33.2006ZM15.706 26.5852C16.2376 26.3917 16.7796 26.2854 17.3166 26.2578C18.6861 27.3467 20.2988 28.0984 22.0132 28.4479C22.3376 28.8773 22.6057 29.3608 22.7994 29.8929C22.9929 30.4246 23.0979 30.9669 23.1255 31.5039C22.0369 32.8735 21.2848 34.4863 20.9354 36.2005C20.5063 36.5246 20.0234 36.7927 19.4917 36.9862C16.6195 38.0316 13.4437 36.5507 12.3984 33.6786C11.353 30.8064 12.8339 27.6306 15.706 26.5852ZM36.5081 19.0139C39.3802 17.9685 42.556 19.4494 43.6014 22.3216C44.6468 25.1938 43.1659 28.3695 40.2937 29.4149C39.7616 29.6086 39.2189 29.714 38.6814 29.7415C37.3117 28.6529 35.6993 27.9007 33.9848 27.5515C33.6608 27.1224 33.3939 26.6388 33.2004 26.1072C33.0067 25.5752 32.9 25.0328 32.8725 24.4954C33.9614 23.1257 34.7132 21.5134 35.0626 19.7988C35.4919 19.4745 35.976 19.2076 36.5081 19.0139ZM22.3214 12.3986C25.1935 11.3532 28.3693 12.8341 29.4147 15.7062C29.6082 16.238 29.7133 16.7802 29.7408 17.3173C28.6522 18.6868 27.9002 20.2996 27.5508 22.0138C27.1216 22.338 26.6388 22.606 26.107 22.7996C25.5749 22.9933 25.0322 23.0987 24.4947 23.1262C23.125 22.0375 21.5126 21.2853 19.7982 20.9361C19.4742 20.507 19.2072 20.0235 19.0137 19.4919C17.9683 16.6197 19.4492 13.4439 22.3214 12.3986ZM54.0024 18.5359C56.565 25.5767 54.0658 33.2235 48.3655 37.4967C48.7561 44.6101 44.5047 51.44 37.464 54.0026C30.4232 56.5653 22.7751 54.0667 18.502 48.3662C11.389 48.7562 4.55981 44.5045 1.99735 37.4642C-0.56516 30.4238 1.93275 22.7759 7.63251 18.5026C7.2423 11.3895 11.4953 4.56006 18.5357 1.99756C25.576 -0.564904 33.2227 1.93364 37.4961 7.63318C44.6096 7.24239 51.4397 11.4951 54.0024 18.5359Z"
                        fill="currentColor"
                      />
                      <path
                        d="M29.4147 15.7062C30.4601 18.5784 28.9792 21.7542 26.107 22.7995C23.2349 23.8449 20.0591 22.364 19.0137 19.4919C17.9683 16.6197 19.4492 13.4439 22.3214 12.3985C25.1935 11.3531 28.3693 12.834 29.4147 15.7062Z"
                        fill="currentColor"
                      />
                      <path
                        d="M36.986 36.5081C38.0314 39.3803 36.5505 42.5561 33.6783 43.6015C30.8061 44.6469 27.6303 43.166 26.585 40.2938C25.5396 37.4216 27.0205 34.2458 29.8926 33.2005C32.7648 32.1551 35.9406 33.636 36.986 36.5081Z"
                        fill="currentColor"
                      />
                      <path
                        d="M43.6015 22.3216C44.6468 25.1937 43.1659 28.3695 40.2938 29.4149C37.4216 30.4603 34.2458 28.9794 33.2004 26.1072C32.1551 23.2351 33.636 20.0593 36.5081 19.0139C39.3803 17.9685 42.5561 19.4494 43.6015 22.3216Z"
                        fill="currentColor"
                      />
                      <path
                        d="M22.7995 29.8928C23.8448 32.7649 22.3639 35.9407 19.4918 36.9861C16.6196 38.0315 13.4438 36.5506 12.3984 33.6784C11.3531 30.8063 12.834 27.6305 15.7061 26.5851C18.5783 25.5397 21.7541 27.0206 22.7995 29.8928Z"
                        fill="currentColor"
                      />
                    </g>
                    <defs>
                      <clipPath id="orchard-chip-clip">
                        <rect width="56" height="56" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>

                  <Icon
                    v-else-if="preset.icon === 'vercel'"
                    name="simple-icons:vercel"
                    size="0.875rem"
                    class="shrink-0"
                    aria-hidden="true"
                  />

                  {{ preset.label }}
                </button>
              </div>
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

            <div
              v-if="showProxyToggle && canProxy"
              class="flex w-auto shrink-0 flex-col justify-end"
            >
              <span class="mb-1.5 block text-sm font-medium text-snow">Proxy status</span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.proxied"
                class="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-border bg-darker px-3 text-sm transition-colors hover:border-muted"
                :title="
                  form.proxied
                    ? 'Traffic is proxied through Cloudflare (orange cloud)'
                    : 'DNS only — not proxied through Cloudflare'
                "
                @click="form.proxied = !form.proxied"
              >
                <span
                  class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  :class="form.proxied ? 'bg-primary' : 'bg-steel'"
                >
                  <span
                    class="inline-block size-4 rounded-full bg-white shadow transition-transform"
                    :class="form.proxied ? 'translate-x-4' : 'translate-x-0.5'"
                  />
                </span>
                <Icon
                  name="material-symbols:cloud"
                  size="1.15rem"
                  :class="form.proxied ? 'text-orange' : 'text-muted'"
                />
                <span :class="form.proxied ? 'text-snow' : 'text-muted'">
                  {{ form.proxied ? "Proxied" : "DNS only" }}
                </span>
              </button>
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
                class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none placeholder:text-muted/70 focus:border-primary disabled:opacity-50"
                placeholder="Leave empty for default"
                :disabled="form.proxied && canProxy"
              />
              <p class="mt-1 text-xs text-muted">
                {{
                  form.proxied && canProxy
                    ? "TTL is Auto while Cloudflare proxy is on."
                    : "Only set this if you need a custom TTL."
                }}
              </p>
            </div>
          </div>

          <div class="flex gap-2 border-t border-border pt-4">
            <button
              type="submit"
              class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/85 disabled:opacity-50"
              :disabled="!canSubmit"
            >
              Open Pull Request
            </button>
            <button
              type="button"
              class="rounded-lg border border-border px-4 py-2 text-sm text-snow transition-colors hover:bg-darkless disabled:opacity-50"
              :disabled="sending || refreshingFork"
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

  <SuccessModal
    :show="showSuccess"
    :pr-url="prUrl"
    :needs-manual-pr="needsManualPr"
    :via-app="viaApp"
    @close="onSuccessClose"
  />
</template>
