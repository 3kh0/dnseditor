<script setup lang="ts">
import {
  bareDomain,
  hasContact,
  isSubdomain,
  recordValueError,
  selfReferenceError,
  supportsCfProxy,
} from "#shared/dns";

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
  forkPending,
  login,
  refresh,
} = useAuth();

const CONTACT_KEY = "dnseditor:contact";

const mode = ref<"add" | "edit" | "delete" | null>(null);
const deleteFromEdit = ref(false);
const modalPanel = ref<{ scrollTo: (options?: ScrollToOptions) => void } | null>(null);
const error = ref<string | null>(null);
const submissionErrorCode = ref<string | null>(null);
const submissionInstallUrl = ref<string | null>(null);

interface AppAccess {
  accessible: boolean;
  installed: boolean;
  manageUrl: string | null;
  missingPermissions: string[];
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
    proxyByDefault: true,
  },
  {
    id: "coolify-b",
    label: "Coolify B",
    value: "b.selfhosted.hackclub.com.",
    icon: "coolify-b" as const,
    proxyByDefault: true,
  },
  {
    id: "orchard",
    label: "Orchard",
    value: "a.ingress.tier2.infra.hackclub.com.",
    icon: "orchard" as const,
    proxyByDefault: true,
  },
  {
    id: "vercel",
    label: "Vercel",
    value: "cname.vercel-dns.com.",
    icon: "vercel" as const,
    proxyByDefault: false,
  },
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

const valueError = computed(() => {
  const { type, value, subdomain } = form.value;
  const v = value.trim();
  if (!v) return null;
  return recordValueError(type, v) ?? selfReferenceError(type, v, subdomain.trim(), props.domain);
});

const valueFocused = ref(false);
const valueTouched = ref(false);
const showValueError = computed(
  () => !!valueError.value && (valueTouched.value || !valueFocused.value),
);

const currentRecordValid = computed(() => {
  const { subdomain, value, ttl, type, mxPreference } = form.value;
  const s = subdomain.trim();
  const v = value.trim();
  if (!s || !v) return false;
  if (ttl !== "" && (!(Number(ttl) > 0) || !Number.isFinite(Number(ttl)))) return false;
  if (!isSubdomain(s)) return false;
  if (valueError.value) return false;
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

const needsManualFork = computed(
  () => authenticated.value && !authPending.value && !forkPending.value && !fork.value,
);
const canSubmit = computed(
  () =>
    isValid.value &&
    !sending.value &&
    !refreshingFork.value &&
    !forkPending.value &&
    authenticated.value &&
    !!fork.value &&
    appAccess.value?.accessible !== false,
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
const missingWorkflowsPermission = computed(() =>
  appAccess.value?.missingPermissions.includes("workflows"),
);
const appAccessActionLabel = computed(() =>
  missingWorkflowsPermission.value
    ? "Review app permissions"
    : appAccess.value?.installed
      ? "Add your fork to the app"
      : "Install GitHub App",
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
  document.body.classList.remove("modal-open");
});

watch(
  [() => props.show, showSuccess],
  ([editorOpen, successOpen]) => {
    if (import.meta.client) {
      document.body.classList.toggle("modal-open", editorOpen || successOpen);
    }
  },
  { immediate: true },
);

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
      mode.value = "add";
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
  valueTouched.value = false;
  valueFocused.value = false;
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
  valueTouched.value = false;
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

const applyCnamePreset = (preset: (typeof cnamePresets)[number]) => {
  form.value.type = "CNAME";
  form.value.value = preset.value;
  if (preset.proxyByDefault && supportsCfProxy(props.domain, "CNAME")) {
    form.value.proxied = true;
  }
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
  close();
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
    } else if (access.missingPermissions.includes("workflows")) {
      error.value =
        "The GitHub App still needs read and write access to workflows. Approve the new permission on GitHub, then return here.";
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
            : code === "APP_WORKFLOWS_PERMISSION_REQUIRED"
              ? "The GitHub App needs read and write access to workflows before it can sync your fork."
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
    <AnimatedModal
      ref="modalPanel"
      :show="show"
      labelledby="edit-record-title"
      z-class="z-50"
      panel-class="relative max-h-[calc(100dvh-0.5rem)] w-full max-w-2xl overscroll-contain overflow-y-auto rounded-t-xl border border-border bg-dark p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:mx-4 sm:max-h-[90vh] sm:rounded-xl sm:p-6"
      @close="close"
    >
      <Transition name="fade">
        <div
          v-if="sending || refreshingFork"
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-dark/80 backdrop-blur-sm"
        >
          <div class="flex flex-col items-center gap-3 px-4 text-center text-primary">
            <Icon name="material-symbols:progress-activity" size="3em" class="animate-spin" />
            <span class="text-sm text-snow">{{ statusMessage || "Working…" }}</span>
          </div>
        </div>
      </Transition>

      <div
        class="sticky -top-4 z-10 -mx-4 mb-5 flex items-center justify-between border-b border-border bg-dark/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
      >
        <h2 id="edit-record-title" class="text-xl font-semibold text-snow sm:text-2xl">
          {{ modalTitle }}
        </h2>
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-darkless hover:text-snow sm:size-9 sm:border sm:border-border sm:hover:border-muted"
          aria-label="Close dialog"
          @click="close"
        >
          <Icon name="material-symbols:close-rounded" size="1.25rem" />
        </button>
      </div>

      <form
        v-if="mode === 'add' || mode === 'edit' || mode === 'delete'"
        class="space-y-4 sm:space-y-5"
        @submit.prevent="submit"
      >
        <div
          v-if="needsHqApproval && !isEdit && !isDelete"
          class="flex gap-2 rounded-lg border border-yellow/20 bg-yellow/10 p-3 text-yellow"
        >
          <Icon name="material-symbols:warning" class="mt-0.5 shrink-0" size="1rem" />
          <p class="text-sm">
            Changes to this domain need HQ approval. Only continue if you already have the green
            light.
          </p>
        </div>

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
          <p v-if="missingWorkflowsPermission">
            The GitHub App is installed but does not have read and write access to workflows.
            Approve the new permission on GitHub before submitting.
          </p>
          <p v-else-if="appAccess?.installed">
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
            v-if="
              (submissionErrorCode === 'APP_INSTALL_REQUIRED' ||
                submissionErrorCode === 'APP_WORKFLOWS_PERMISSION_REQUIRED') &&
              appInstallUrl
            "
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

          <template v-else-if="forkPending">
            <p class="text-muted">Looking for your fork…</p>
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
            <TransitionGroup name="list" tag="ul" class="space-y-1.5">
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
            </TransitionGroup>
            <p class="mt-2 text-xs text-muted">All queued records go into a single pull request.</p>
          </div>

          <p
            v-if="isEdit || queued.length === 0 || currentCountsAsRecord"
            class="hidden wrap-break-word text-lg text-snow sm:block"
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

          <div class="flex flex-col gap-3 sm:flex-row">
            <div class="w-full shrink-0 sm:w-28">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="type">Type</label>
              <select
                id="type"
                v-model="form.type"
                class="min-h-11 w-full rounded-lg border border-border bg-darker px-3 py-2 text-base text-snow outline-none focus:border-primary sm:min-h-0 sm:text-sm"
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
                class="min-h-11 w-full rounded-lg border border-border bg-darker px-3 py-2 text-base text-snow outline-none placeholder:text-muted/70 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm"
                :placeholder="`coolsubdomain (becomes coolsubdomain.${bare})`"
                :disabled="isEdit"
                :title="isEdit ? 'Subdomain cannot be changed when editing' : undefined"
              />
              <p v-if="isEdit" class="mt-1 text-xs text-muted">Name can't be changed here.</p>
            </div>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row">
            <div class="min-w-0 flex-1">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="value">
                {{ form.type === "MX" ? "Exchange" : "Value" }}
              </label>
              <input
                id="value"
                v-model="form.value"
                type="text"
                spellcheck="false"
                class="min-h-11 w-full rounded-lg border bg-darker px-3 py-2 text-base text-snow outline-none placeholder:text-muted/70 sm:min-h-0 sm:text-sm"
                :class="
                  showValueError
                    ? 'border-red/60 focus:border-red'
                    : 'border-border focus:border-primary'
                "
                :placeholder="valuePlaceholder"
                :aria-invalid="showValueError || undefined"
                :aria-describedby="showValueError ? 'value-error' : undefined"
                @focus="valueFocused = true"
                @blur="
                  valueFocused = false;
                  valueTouched = true;
                "
              />

              <p v-if="showValueError" id="value-error" class="mt-1.5 text-xs text-red">
                {{ valueError }}
              </p>

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
                  class="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 sm:px-2.5"
                  :class="
                    isCnamePresetActive(preset.value)
                      ? 'border-primary bg-primary/15 text-snow'
                      : 'border-border bg-darker text-muted hover:border-muted hover:text-snow'
                  "
                  :title="preset.value"
                  @click="applyCnamePreset(preset)"
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

            <div v-if="form.type === 'MX'" class="w-full shrink-0 sm:w-28">
              <label class="mb-1.5 block text-sm font-medium text-snow" for="mx-preference"
                >Priority</label
              >
              <input
                id="mx-preference"
                v-model.number="form.mxPreference"
                type="number"
                min="0"
                class="min-h-11 w-full rounded-lg border border-border bg-darker px-3 py-2 text-base text-snow outline-none focus:border-primary sm:min-h-0 sm:text-sm"
              />
            </div>

            <div
              v-if="showProxyToggle && canProxy"
              class="flex w-full shrink-0 flex-col justify-end sm:w-auto"
            >
              <span class="mb-1.5 block text-sm font-medium text-snow">Proxy status</span>
              <button
                type="button"
                role="switch"
                :aria-checked="form.proxied"
                class="inline-flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-darker px-3 text-sm transition-colors hover:border-muted sm:h-9.5 sm:min-h-0 sm:w-auto"
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
              class="min-h-11 w-full rounded-lg border border-border bg-darker px-3 py-2 text-base text-snow outline-none placeholder:text-muted/70 focus:border-primary sm:min-h-0 sm:text-sm"
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
            <Transition name="notice">
              <div v-if="showAdvanced" class="mt-3">
                <label class="mb-1.5 block text-sm font-medium text-snow" for="ttl">TTL</label>
                <input
                  id="ttl"
                  v-model="form.ttl"
                  type="number"
                  min="1"
                  class="min-h-11 w-full rounded-lg border border-border bg-darker px-3 py-2 text-base text-snow outline-none placeholder:text-muted/70 focus:border-primary disabled:opacity-50 sm:min-h-0 sm:text-sm"
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
            </Transition>
          </div>
        </template>

        <div
          class="sticky -bottom-4 z-10 -mx-4 border-t border-border bg-dark/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-4 sm:backdrop-blur-none"
        >
          <p v-if="isEdit && !hasChanges" class="mb-2 text-xs text-muted">
            Change at least one field to open a pull request.
          </p>

          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              v-if="!isDelete"
              type="submit"
              class="min-h-11 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/85 disabled:opacity-50 sm:min-h-0 sm:w-auto"
              :disabled="!canSubmit"
            >
              Open Pull Request{{ !isEdit && totalRecords > 1 ? ` (${totalRecords} records)` : "" }}
            </button>

            <div class="grid grid-cols-2 gap-2 sm:contents">
              <button
                v-if="!isEdit && !isDelete"
                type="button"
                class="min-h-11 w-full rounded-lg border border-border px-3 py-2 text-sm text-snow transition-colors hover:bg-darkless disabled:opacity-50 sm:min-h-0 sm:w-auto sm:px-4"
                :disabled="!currentRecordValid || sending || refreshingFork"
                title="Queue this record and add another one to the same pull request"
                @click="queueCurrentRecord"
              >
                Add another
              </button>
              <button
                v-if="isEdit"
                type="button"
                class="min-h-11 w-full rounded-lg border border-red/30 px-3 py-2 text-sm text-red transition-colors hover:bg-red/10 disabled:opacity-50 sm:min-h-0 sm:w-auto sm:px-4"
                :disabled="sending || refreshingFork"
                @click="startDelete"
              >
                Delete record
              </button>
              <button
                v-if="isDelete"
                type="submit"
                class="min-h-11 w-full rounded-lg bg-red px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red/85 disabled:opacity-50 sm:min-h-0 sm:w-auto sm:px-4"
                :disabled="!canSubmit"
              >
                Delete record
              </button>
              <button
                type="button"
                class="min-h-11 w-full rounded-lg border border-border px-3 py-2 text-sm text-snow transition-colors hover:bg-darkless disabled:opacity-50 sm:min-h-0 sm:w-auto sm:px-4"
                :disabled="sending || refreshingFork"
                @click="back"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </form>
    </AnimatedModal>
  </Teleport>

  <SuccessModal
    :show="showSuccess"
    :pr-url="prUrl"
    :needs-manual-pr="needsManualPr"
    :via-app="viaApp"
    @close="onSuccessClose"
  />
</template>
