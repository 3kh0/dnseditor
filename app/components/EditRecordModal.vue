<script setup lang="ts">
import { bareDomain, hasContact, isSubdomain, supportsCfProxy } from "#shared/dns";

export interface EditingRecord {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference?: number;
  proxied?: boolean;
  contact?: string;
}

const props = withDefaults(
  defineProps<{
    show: boolean;
    domain: string;
    editing?: EditingRecord | null;
    initialMode?: "edit" | "delete";
  }>(),
  { initialMode: "edit" },
);
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

const mode = ref<"menu" | "add" | "edit" | "delete" | null>(null);
const deleteFromEdit = ref(false);
const modalPanel = ref<HTMLElement | null>(null);
const error = ref<string | null>(null);
const submissionErrorCode = ref<string | null>(null);
const submissionInstallUrl = ref<string | null>(null);

interface AppAccess {
  accessible: boolean;
  installed: boolean;
  manageUrl: string | null;
}
const appAccess = ref<AppAccess | null>(null);
const appInstallNotice = ref<string | null>(null);
const awaitingAppInstall = ref(false);
const checkingAppInstall = ref(false);
const sending = ref(false);
const showSuccess = ref(false);
const prUrl = ref("");
const needsManualPr = ref(false);
const viaApp = ref<string | null>(null);
const showAdvanced = ref(false);
const refreshingFork = ref(false);
const statusMessage = ref<string | null>(null);

const original = ref<EditingRecord | null>(null);

interface QueuedRecord {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference: number;
  proxied: boolean;
}

const queued = ref<QueuedRecord[]>([]);

const form = ref({
  subdomain: "",
  type: "CNAME",
  value: "",
  ttl: "" as number | "",
  contact: "",
  mxPreference: 10,
  proxied: false,
});

const isEdit = computed(() => mode.value === "edit" && !!original.value);
const isDelete = computed(() => mode.value === "delete" && !!original.value);

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

const contactValid = computed(() => hasContact(form.value.contact.trim()));

/** True when the in-progress record fields (everything but contact) form a valid record. */
const currentRecordValid = computed(() => {
  const { subdomain, value, ttl, type, mxPreference } = form.value;
  const s = subdomain.trim();
  const v = value.trim();
  if (!s || !v) return false;
  if (ttl !== "" && (!(Number(ttl) > 0) || !Number.isFinite(Number(ttl)))) return false;
  if (!isSubdomain(s)) return false;
  if (type === "MX") {
    const pref = Number(mxPreference);
    if (!Number.isFinite(pref) || pref < 0) return false;
  }
  return true;
});

/** The in-progress form counts as a record once a value is typed. */
const currentCountsAsRecord = computed(() => form.value.value.trim() !== "");

const totalRecords = computed(
  () => queued.value.length + (currentCountsAsRecord.value && currentRecordValid.value ? 1 : 0),
);

const isValid = computed(() => {
  if (isDelete.value) return true;
  if (!contactValid.value) return false;
  if (isEdit.value) return currentRecordValid.value && hasChanges.value;
  if (queued.value.length > 0) {
    // A half-typed record blocks submit instead of being silently dropped.
    return !currentCountsAsRecord.value || currentRecordValid.value;
  }
  return currentRecordValid.value;
});

/** True when the form differs from the original record being edited. */
const hasChanges = computed(() => {
  if (!original.value) return true;
  const o = original.value;
  const f = form.value;
  if (f.type !== o.type) return true;
  if (f.value.trim() !== o.value.trim()) return true;
  if (Boolean(f.proxied) !== Boolean(o.proxied)) return true;
  const formTtl = f.ttl === "" ? undefined : Number(f.ttl);
  const origTtl = o.ttl;
  if (formTtl !== origTtl) return true;
  if (f.type === "MX" || o.type === "MX") {
    if (Number(f.mxPreference) !== Number(o.mxPreference ?? 10)) return true;
  }
  return false;
});

const needsManualFork = computed(() => authenticated.value && !authPending.value && !fork.value);
const canSubmit = computed(
  () =>
    isValid.value && !sending.value && !refreshingFork.value && authenticated.value && !!fork.value,
);

const defaultManualForkUrl = computed(
  () => manualForkUrl.value || `https://github.com/${upstreamLabel.value}/fork`,
);
const appInstallUrl = computed(
  () => appAccess.value?.manageUrl || submissionInstallUrl.value || installUrl.value,
);

const appAccessBlocked = computed(
  () =>
    !!appAccess.value &&
    !appAccess.value.accessible &&
    authenticated.value &&
    !!fork.value &&
    !error.value,
);
const appAccessActionLabel = computed(() =>
  appAccess.value?.installed ? "Add your fork to the app" : "Install GitHub App",
);

const modalTitle = computed(() =>
  isDelete.value ? "Delete record" : isEdit.value ? "Edit record" : "Add record",
);

let appInstallWindow: Window | null = null;
let appInstallPoll: number | null = null;
let appInstallStartedAt = 0;

onMounted(() => {
  window.addEventListener("focus", handleAppInstallFocus);
  window.addEventListener("message", handleAppInstallMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", handleAppInstallFocus);
  window.removeEventListener("message", handleAppInstallMessage);
  stopAppInstallPoll();
});

watch(
  () => props.show,
  async (open) => {
    if (!open) return;
    error.value = null;
    submissionErrorCode.value = null;
    submissionInstallUrl.value = null;
    appInstallNotice.value = null;
    appAccess.value = null;
    statusMessage.value = null;
    showAdvanced.value = false;
    deleteFromEdit.value = false;

    if (props.editing) {
      applyEditing(props.editing);
      mode.value = props.initialMode;
    } else {
      original.value = null;
      mode.value = "menu";
      if (!form.value.contact.trim()) form.value.contact = loadContact();
    }
    await refresh();
    void checkAppAccess();
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
  original.value = null;
  queued.value = [];
  showAdvanced.value = false;
  statusMessage.value = null;
}

function snapshotCurrentRecord(): QueuedRecord {
  return {
    subdomain: form.value.subdomain.trim().toLowerCase(),
    type: form.value.type,
    value: form.value.value.trim(),
    ...(form.value.ttl !== "" && !(form.value.proxied && canProxy.value)
      ? { ttl: Number(form.value.ttl) }
      : {}),
    mxPreference: Number(form.value.mxPreference),
    proxied: form.value.proxied && canProxy.value,
  };
}

function queueCurrentRecord() {
  if (!currentRecordValid.value) return;
  queued.value.push(snapshotCurrentRecord());
  // Keep subdomain (batches often target related names) and contact; clear the rest.
  form.value.value = "";
  form.value.ttl = "";
  form.value.mxPreference = 10;
  form.value.proxied = false;
}

function removeQueuedRecord(index: number) {
  queued.value.splice(index, 1);
}

function applyEditing(rec: EditingRecord) {
  original.value = { ...rec };
  form.value = {
    subdomain: rec.subdomain,
    type: rec.type,
    value: rec.value,
    ttl: rec.ttl ?? "",
    contact: rec.contact?.trim() || loadContact(),
    mxPreference: rec.mxPreference ?? 10,
    proxied: rec.proxied === true,
  };
  showAdvanced.value = rec.ttl !== undefined;
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
  submissionErrorCode.value = null;
  submissionInstallUrl.value = null;
  appInstallNotice.value = null;
  resetForm();
  emit("close");
}

function back() {
  if (isDelete.value && deleteFromEdit.value) {
    mode.value = "edit";
    deleteFromEdit.value = false;
    error.value = null;
    submissionErrorCode.value = null;
    submissionInstallUrl.value = null;
    appInstallNotice.value = null;
    statusMessage.value = null;
    return;
  }
  if (isEdit.value || isDelete.value) {
    close();
    return;
  }
  mode.value = "menu";
  error.value = null;
  submissionErrorCode.value = null;
  submissionInstallUrl.value = null;
  appInstallNotice.value = null;
  statusMessage.value = null;
}

function startDelete() {
  deleteFromEdit.value = true;
  error.value = null;
  submissionErrorCode.value = null;
  submissionInstallUrl.value = null;
  appInstallNotice.value = null;
  mode.value = "delete";
}

const startLogin = () => {
  const returnTo = isEdit.value
    ? `/?domain=${encodeURIComponent(props.domain)}`
    : `/?openAdd=1&domain=${encodeURIComponent(props.domain)}`;
  login(returnTo);
};

async function refreshAfterManualFork() {
  error.value = null;
  submissionErrorCode.value = null;
  submissionInstallUrl.value = null;
  statusMessage.value = "Looking for your fork…";
  refreshingFork.value = true;
  try {
    await refresh();
    if (fork.value) {
      statusMessage.value = `Found fork ${fork.value.fullName}`;
      void checkAppAccess();
    } else {
      statusMessage.value = null;
      error.value = `Still no fork of ${upstreamLabel.value} on your account. Fork it on GitHub, wait a few seconds, then try again.`;
    }
  } finally {
    refreshingFork.value = false;
  }
}

async function checkAppAccess() {
  if (!authenticated.value || !fork.value) {
    appAccess.value = null;
    return;
  }
  try {
    appAccess.value = await $fetch<AppAccess>("/api/auth/app-access");
  } catch {
    appAccess.value = null;
  }
}

function openAppInstall() {
  const url = appInstallUrl.value;
  if (!url) return;

  appInstallNotice.value = null;
  awaitingAppInstall.value = true;
  appInstallStartedAt = Date.now();
  appInstallWindow = window.open(
    url,
    "dns-editor-github-app-install",
    "popup,width=760,height=760",
  );

  if (!appInstallWindow) {
    awaitingAppInstall.value = false;
    error.value =
      "Your browser blocked the GitHub installation window. Allow pop-ups and try again.";
    return;
  }

  error.value = "Finish installing the GitHub App in the new window. Your changes will stay here.";
  stopAppInstallPoll();
  appInstallPoll = window.setInterval(() => {
    if (appInstallWindow?.closed) void refreshAfterAppInstall();
  }, 500);
}

function handleAppInstallFocus() {
  if (awaitingAppInstall.value && Date.now() - appInstallStartedAt > 1000) {
    void refreshAfterAppInstall();
  }
}

function handleAppInstallMessage(event: MessageEvent) {
  if (
    event.origin === window.location.origin &&
    event.data?.type === "dns-editor:github-app-installed"
  ) {
    void refreshAfterAppInstall();
  }
}

function stopAppInstallPoll() {
  if (appInstallPoll) window.clearInterval(appInstallPoll);
  appInstallPoll = null;
}

async function refreshAfterAppInstall() {
  if (!awaitingAppInstall.value || checkingAppInstall.value) return;

  awaitingAppInstall.value = false;
  checkingAppInstall.value = true;
  stopAppInstallPoll();

  try {
    await refresh();
    const access = await $fetch<AppAccess>("/api/auth/app-access");
    appAccess.value = access;
    if (access.accessible) {
      error.value = null;
      submissionErrorCode.value = null;
      submissionInstallUrl.value = null;
      appInstallNotice.value =
        "GitHub App access is ready. Your changes are still here—open the pull request again.";
    } else {
      error.value =
        "The GitHub App still cannot access your fork. Update the installation and select your DNS fork, then return here.";
    }
  } catch {
    error.value = "Could not verify GitHub App access. Return here and try again.";
  } finally {
    checkingAppInstall.value = false;
    await nextTick();
    modalPanel.value?.scrollTo({ top: 0 });
  }
}

async function submit() {
  if (!canSubmit.value) return;

  try {
    error.value = null;
    submissionErrorCode.value = null;
    submissionInstallUrl.value = null;
    appInstallNotice.value = null;
    sending.value = true;
    statusMessage.value = `Opening PR via ${fork.value!.fullName}…`;

    let body: Record<string, unknown>;

    if (isDelete.value && original.value) {
      body = {
        domain: props.domain,
        action: "delete",
        record: {
          subdomain: original.value.subdomain,
          type: original.value.type,
          value: original.value.value,
          ...(original.value.type === "MX"
            ? { mxPreference: Number(original.value.mxPreference ?? 10) }
            : {}),
        },
      };
    } else if (isEdit.value && original.value) {
      body = {
        domain: props.domain,
        action: "edit",
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
        original: {
          type: original.value.type,
          value: original.value.value,
          ...(original.value.type === "MX"
            ? { mxPreference: Number(original.value.mxPreference ?? 10) }
            : {}),
        },
      };
    } else {
      const records = [
        ...queued.value,
        ...(currentCountsAsRecord.value && currentRecordValid.value
          ? [snapshotCurrentRecord()]
          : []),
      ].map((r) => ({
        subdomain: r.subdomain,
        type: r.type,
        value: r.value,
        ...(r.ttl !== undefined ? { ttl: r.ttl } : {}),
        ...(r.type === "MX" ? { mxPreference: r.mxPreference } : {}),
        ...(r.proxied ? { proxied: true } : {}),
      }));

      body = {
        domain: props.domain,
        action: "add",
        contact: form.value.contact.trim(),
        records,
      };
    }

    const response = await $fetch<{
      success: boolean;
      prUrl: string;
      needsManualPr?: boolean;
      viaApp?: string | null;
    }>("/api/submit", {
      method: "POST",
      body,
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
    submissionErrorCode.value = code;
    submissionInstallUrl.value = errInstallUrl(err);
    error.value =
      code === "AUTH_REQUIRED"
        ? "Sign in with GitHub to open a pull request."
        : code === "INVALID_TOKEN_TYPE"
          ? "Your session is not a GitHub App user token (ghu_). Sign out and sign in again with the GitHub App."
          : code === "FORK_REQUIRED"
            ? `You need a fork of ${upstreamLabel.value} on your account first.`
            : code === "APP_INSTALL_REQUIRED"
              ? "The GitHub App needs access to your fork before it can push this change."
              : errMsg(err);
    statusMessage.value = null;
    await nextTick();
    modalPanel.value?.scrollTo({ top: 0 });
  } finally {
    sending.value = false;
  }
}

function errCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: { data?: { code?: string }; code?: string } }).data;
  return data?.data?.code || data?.code || null;
}

function errInstallUrl(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (
    err as { data?: { data?: { installUrl?: string | null }; installUrl?: string | null } }
  ).data;
  return data?.data?.installUrl || data?.installUrl || null;
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
        ref="modalPanel"
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
          <h2 id="edit-record-title" class="text-2xl font-semibold text-snow">{{ modalTitle }}</h2>
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-muted hover:text-snow"
            aria-label="Close dialog"
            @click="close"
          >
            <Icon name="material-symbols:close-rounded" size="1.25rem" />
          </button>
        </div>

        <div v-if="mode === 'menu'" class="space-y-4">
          <div
            v-if="needsHqApproval"
            class="flex gap-2 rounded-lg border border-yellow/20 bg-yellow/10 p-3 text-yellow"
          >
            <Icon name="material-symbols:warning" class="mt-0.5 shrink-0" size="1rem" />
            <p class="text-sm">
              Hold up! Changes to this domain need HQ approval. Only continue if you already have
              the green light (or you are testing and will close the PR).
            </p>
          </div>

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
            so we don't add temporary branches on the main repo. To change an existing record, use
            the
            <strong class="font-medium text-snow">Edit</strong>
            button on a row in the table.
          </p>
        </div>

        <form
          v-else-if="mode === 'add' || mode === 'edit' || mode === 'delete'"
          class="space-y-5"
          @submit.prevent="submit"
        >
          <div
            v-if="appInstallNotice"
            class="rounded-lg border border-green/20 bg-green/10 p-3 text-sm text-green"
          >
            {{ appInstallNotice }}
          </div>

          <div
            v-if="appAccessBlocked"
            class="rounded-lg border border-red/20 bg-red/10 p-3 text-sm text-red"
          >
            <p v-if="appAccess?.installed">
              The GitHub App is installed but can't push to your fork
              <code class="text-snow">{{ fork?.fullName }}</code
              >. Add your fork to the app's repositories, then submit.
            </p>
            <p v-else>
              The GitHub App isn't set up to push to your fork yet. Install it on your account so it
              can open the pull request.
            </p>
            <button
              v-if="appInstallUrl"
              type="button"
              class="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 font-medium text-white transition-colors hover:bg-primary/85"
              :disabled="awaitingAppInstall || checkingAppInstall"
              @click="openAppInstall"
            >
              {{ checkingAppInstall ? "Checking access…" : appAccessActionLabel }}
            </button>
          </div>

          <div v-if="error" class="rounded-lg border border-red/20 bg-red/10 p-3 text-sm text-red">
            <p>{{ error }}</p>
            <button
              v-if="submissionErrorCode === 'APP_INSTALL_REQUIRED' && appInstallUrl"
              type="button"
              class="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 font-medium text-white transition-colors hover:bg-primary/85"
              :disabled="awaitingAppInstall || checkingAppInstall"
              @click="openAppInstall"
            >
              {{ checkingAppInstall ? "Checking access…" : appAccessActionLabel }}
            </button>
          </div>

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
                      <button
                        type="button"
                        class="text-primary underline-offset-2 hover:underline"
                        @click="openAppInstall"
                      >
                        install the app
                      </button>
                      on your account so it can push branches to your fork.
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div
            v-if="isDelete"
            class="flex gap-2 rounded-lg border border-red/20 bg-red/10 p-3 text-red"
          >
            <Icon name="material-symbols:warning" class="mt-0.5 shrink-0" size="1rem" />
            <p class="text-sm">
              Delete
              <strong class="font-medium">{{ form.type }}</strong>
              record
              <strong class="font-medium">{{ previewName }}</strong>
              <template v-if="previewValue">
                → <strong class="font-medium">{{ previewValue }}</strong>
              </template>
              ? This opens a pull request to {{ upstreamLabel }} that removes it once merged.
            </p>
          </div>

          <template v-if="!isDelete">
            <div v-if="!isEdit && queued.length > 0">
              <p class="mb-2 text-sm font-medium text-snow">Queued records ({{ queued.length }})</p>
              <ul class="space-y-1.5">
                <li
                  v-for="(q, i) in queued"
                  :key="`${q.type}-${q.subdomain}-${q.value}-${i}`"
                  class="flex items-center gap-2 rounded-lg border border-border bg-darker px-3 py-2 text-sm"
                >
                  <span
                    class="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary"
                  >
                    {{ q.type }}
                  </span>
                  <span class="shrink-0 truncate text-snow">{{ q.subdomain }}.{{ bare }}</span>
                  <Icon
                    name="material-symbols:arrow-right-alt"
                    size="1rem"
                    class="shrink-0 text-muted"
                  />
                  <span class="min-w-0 flex-1 truncate text-muted" :title="q.value">
                    {{ q.value }}
                  </span>
                  <span
                    v-if="q.proxied"
                    class="shrink-0 rounded bg-orange/15 px-1.5 py-0.5 text-xs text-orange"
                  >
                    Proxied
                  </span>
                  <span
                    v-if="q.ttl !== undefined"
                    class="shrink-0 rounded bg-steel/40 px-1.5 py-0.5 text-xs text-muted"
                  >
                    TTL {{ q.ttl }}
                  </span>
                  <button
                    type="button"
                    class="flex size-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-darkless hover:text-snow"
                    :aria-label="`Remove queued ${q.type} record for ${q.subdomain}.${bare}`"
                    @click="removeQueuedRecord(i)"
                  >
                    <Icon name="material-symbols:close-rounded" size="1rem" />
                  </button>
                </li>
              </ul>
              <p class="mt-2 text-xs text-muted">
                All queued records go into a single pull request.
              </p>
            </div>

            <p
              v-if="isEdit || queued.length === 0 || currentCountsAsRecord"
              class="text-lg text-snow"
            >
              <template v-if="isEdit">Update </template>
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
                <label class="mb-1.5 block text-sm font-medium text-snow" for="subdomain"
                  >Name</label
                >
                <input
                  id="subdomain"
                  v-model="form.subdomain"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full rounded-lg border border-border bg-darker px-3 py-2 text-sm text-snow outline-none placeholder:text-muted/70 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  :placeholder="`coolsubdomain (becomes coolsubdomain.${bare})`"
                  :disabled="isEdit"
                  :title="isEdit ? 'Subdomain cannot be changed when editing' : undefined"
                />
                <p v-if="isEdit" class="mt-1 text-xs text-muted">
                  Name is fixed for edits. Add a new record if you need a different subdomain.
                </p>
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

                    <OrchardIcon v-else-if="preset.icon === 'orchard'" />

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
                  class="inline-flex h-9.5 cursor-pointer items-center gap-2 rounded-lg border border-border bg-darker px-3 text-sm transition-colors hover:border-muted"
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
              <label class="mb-1.5 block text-sm font-medium text-snow" for="contact"
                >Contact</label
              >
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
          </template>

          <div class="flex flex-wrap gap-2 border-t border-border pt-4">
            <button
              type="submit"
              class="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              :class="isDelete ? 'bg-red hover:bg-red/85' : 'bg-primary hover:bg-primary/85'"
              :disabled="!canSubmit"
            >
              {{
                isDelete
                  ? "Delete record"
                  : `Open Pull Request${!isEdit && totalRecords > 1 ? ` (${totalRecords} records)` : ""}`
              }}
            </button>
            <button
              v-if="!isEdit && !isDelete"
              type="button"
              class="rounded-lg border border-border px-4 py-2 text-sm text-snow transition-colors hover:bg-darkless disabled:opacity-50"
              :disabled="!currentRecordValid || sending || refreshingFork"
              title="Queue this record and add another one to the same pull request"
              @click="queueCurrentRecord"
            >
              <Icon name="material-symbols:add" size="0.875rem" class="mr-1" />
              Add another record
            </button>
            <button
              v-if="isEdit"
              type="button"
              class="rounded-lg border border-red/30 px-4 py-2 text-sm text-red transition-colors hover:bg-red/10 disabled:opacity-50"
              :disabled="sending || refreshingFork"
              @click="startDelete"
            >
              Delete record
            </button>
            <button
              type="button"
              class="rounded-lg border border-border px-4 py-2 text-sm text-snow transition-colors hover:bg-darkless disabled:opacity-50"
              :disabled="sending || refreshingFork"
              @click="back"
            >
              {{ isEdit || isDelete ? "Cancel" : "Back" }}
            </button>
          </div>

          <p v-if="isEdit && !hasChanges" class="text-xs text-muted">
            Change at least one field to open a pull request.
          </p>
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
