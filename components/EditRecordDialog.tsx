"use client";

import {
  Badge,
  Banner,
  Button,
  Collapsible,
  Dialog,
  Input,
  InputGroup,
  Link,
  LinkButton,
  Loader,
  Select,
  Switch,
} from "@cloudflare/kumo";
import {
  ArrowRightIcon,
  CloudIcon,
  GithubLogoIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errCode, errInstallUrl } from "@/lib/client/api";
import { useAuth, type AuthState } from "@/lib/client/auth";
import {
  addRecordCollision,
  bareDomain,
  collisionBlocksAdd,
  fmtDnsValue,
  formatCollisionMessage,
  hasContact,
  isSubdomain,
  recordValueError,
  sameRecordTarget,
  selfReferenceError,
  supportsCfProxy,
  type CnameProvider,
  type CollisionRecord,
} from "@/shared/dns";
import type { DnsMxValue, DnsRecordGroup, DnsValue } from "@/shared/types/dns";
import { ProviderIcon } from "./ProviderIcon";
import { SuccessDialog } from "./SuccessDialog";

export interface EditingRecord {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference?: number;
  proxied?: boolean;
  contact?: string;
}

interface AppAccess {
  accessible: boolean;
  installed: boolean;
  manageUrl: string | null;
  missingPermissions: string[];
}

interface QueuedRecord {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference: number;
  proxied: boolean;
}

interface ExistingRecord extends CollisionRecord {
  ttl?: number;
  proxied?: boolean;
  mxPreference?: number;
  contact?: string;
  source: "existing" | "queued";
}

interface FormState {
  subdomain: string;
  type: string;
  value: string;
  ttl: string;
  contact: string;
  mxPreference: string;
  proxied: boolean;
}

interface SubmitResponse {
  success: boolean;
  prUrl: string;
  needsManualPr?: boolean;
  viaApp?: string | null;
}

const CONTACT_KEY = "dnseditor:contact";

const RECORD_TYPES = ["A", "AAAA", "CNAME", "ALIAS", "TXT", "MX"] as const;

const CNAME_PRESETS: readonly {
  id: CnameProvider;
  label: string;
  value: string;
  proxyByDefault: boolean;
}[] = [
  {
    id: "coolify-a",
    label: "Coolify A",
    value: "a.selfhosted.hackclub.com.",
    proxyByDefault: true,
  },
  {
    id: "coolify-limited-a",
    label: "Coolify limited A",
    value: "a.limited.selfhosted.hackclub.com.",
    proxyByDefault: true,
  },
  {
    id: "coolify-b",
    label: "Coolify B",
    value: "b.selfhosted.hackclub.com.",
    proxyByDefault: true,
  },
  {
    id: "orchard",
    label: "Orchard",
    value: "a.ingress.tier2.infra.hackclub.com.",
    proxyByDefault: true,
  },
  { id: "vercel", label: "Vercel", value: "cname.vercel-dns.com.", proxyByDefault: false },
];

const isMxValue = (v: DnsValue): v is DnsMxValue => typeof v === "object" && v !== null;

function recordValueString(type: string, v: DnsValue): { value: string; mxPreference?: number } {
  if (type === "MX" && isMxValue(v)) {
    return {
      value: v.exchange ? String(v.exchange) : "",
      mxPreference: Number(v.preference ?? v.priority ?? 10),
    };
  }
  return { value: v === "" ? "" : fmtDnsValue(v) };
}

function loadContact(): string {
  try {
    return localStorage.getItem(CONTACT_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function saveContact(c: string) {
  try {
    localStorage.setItem(CONTACT_KEY, c);
  } catch {
    /* ignore */
  }
}

const emptyForm = (contact = ""): FormState => ({
  subdomain: "",
  type: "CNAME",
  value: "",
  ttl: "",
  contact,
  mxPreference: "10",
  proxied: false,
});

const formFromRecord = (rec: EditingRecord): FormState => ({
  subdomain: rec.subdomain,
  type: rec.type,
  value: rec.value,
  ttl: rec.ttl === undefined ? "" : String(rec.ttl),
  contact: rec.contact?.trim() || loadContact(),
  mxPreference: String(rec.mxPreference ?? 10),
  proxied: rec.proxied === true,
});

export function EditRecordDialog({
  show,
  domain,
  groups = [],
  groupsPending = false,
  editing,
  initialMode = "edit",
  onClose,
  onRefresh,
}: {
  show: boolean;
  domain: string;
  groups?: DnsRecordGroup[];
  /** True while `groups` is being refetched — stale checks wait for it to settle. */
  groupsPending?: boolean;
  editing?: EditingRecord | null;
  initialMode?: "edit" | "delete";
  onClose: () => void;
  onRefresh: () => void;
}) {
  const auth = useAuth();
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
  } = auth;

  const [mode, setMode] = useState<"add" | "edit" | "delete" | null>(null);
  const [deleteFromEdit, setDeleteFromEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionErrorCode, setSubmissionErrorCode] = useState<string | null>(null);
  const [submissionInstallUrl, setSubmissionInstallUrl] = useState<string | null>(null);
  const [appAccess, setAppAccess] = useState<AppAccess | null>(null);
  const [appInstallNotice, setAppInstallNotice] = useState<string | null>(null);
  const [awaitingAppInstall, setAwaitingAppInstall] = useState(false);
  const [checkingAppInstall, setCheckingAppInstall] = useState(false);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState<{ prUrl: string; needsManualPr: boolean } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refreshingFork, setRefreshingFork] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [original, setOriginal] = useState<EditingRecord | null>(null);
  const [queued, setQueued] = useState<QueuedRecord[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [valueFocused, setValueFocused] = useState(false);
  const [valueTouched, setValueTouched] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToTop = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const isEdit = mode === "edit" && !!original;
  const isDelete = mode === "delete" && !!original;
  const bare = bareDomain(domain);
  const needsHqApproval = domain !== "dino.icu.yaml";
  const canProxy = supportsCfProxy(domain, form.type);
  const showProxyToggle = supportsCfProxy(domain);
  const upstreamLabel =
    upstream?.fullName || `${upstream?.owner || "hackclub"}/${upstream?.repo || "dns"}`;

  const sub = form.subdomain.trim();
  const subLower = sub.toLowerCase();
  const previewName = sub ? `${sub}.${bare}` : null;
  const previewValue = form.value.trim() || null;
  const previewVerb =
    form.type === "MX"
      ? "routes mail through"
      : form.type === "TXT"
        ? "has a TXT record with content"
        : "points to";
  const proxySuffix =
    form.proxied && canProxy ? " and has its traffic proxied through Cloudflare" : "";

  const contactValid = hasContact(form.contact.trim());

  const valueError = (() => {
    const v = form.value.trim();
    if (!v) return null;
    return recordValueError(form.type, v) ?? selfReferenceError(form.type, v, sub, domain);
  })();
  const showValueError = !!valueError && (valueTouched || !valueFocused);

  const existingAtName: ExistingRecord[] = !subLower
    ? []
    : [
        ...groups.flatMap((g) => {
          if (g.subdomain.toLowerCase() !== subLower) return [];
          return g.records.flatMap((r) =>
            (r.values.length ? r.values : [""]).map((v) => {
              const parsed = recordValueString(r.type, v);
              return {
                type: r.type,
                value: parsed.value,
                ttl: r.ttl,
                proxied: r.proxied,
                mxPreference: parsed.mxPreference,
                contact: g.contact,
                source: "existing" as const,
              };
            }),
          );
        }),
        ...queued
          .filter((q) => q.subdomain.toLowerCase() === subLower)
          .map((q) => ({
            type: q.type,
            value: q.value,
            ttl: q.ttl,
            proxied: q.proxied,
            mxPreference: q.type === "MX" ? q.mxPreference : undefined,
            source: "queued" as const,
          })),
      ];

  const collision =
    isEdit || isDelete || !sub ? null : addRecordCollision(existingAtName, form.type, form.value);
  const collisionMessage = collision
    ? formatCollisionMessage(collision, { fqdn: `${subLower}.${bare}`, newType: form.type })
    : null;

  /** Records under this name as upstream has them — queued additions excluded. */
  const liveAtName = existingAtName.filter((r) => r.source === "existing");

  const overwriteTarget: ExistingRecord | null = (() => {
    if (!collision || liveAtName.length === 0) return null;
    const want = form.type.toUpperCase();
    return (
      liveAtName.find((r) => r.type.toUpperCase() === want) ??
      liveAtName.find((r) => ["CNAME", "ALIAS"].includes(r.type.toUpperCase())) ??
      liveAtName[0] ??
      null
    );
  })();
  const canOverwrite = !!overwriteTarget && queued.length === 0 && !isEdit && !isDelete;

  const ttlNum = Number(form.ttl);
  const currentRecordValid = (() => {
    const v = form.value.trim();
    if (!sub || !v) return false;
    if (form.ttl !== "" && (!(ttlNum > 0) || !Number.isFinite(ttlNum))) return false;
    if (!isSubdomain(sub)) return false;
    if (valueError) return false;
    if (collisionBlocksAdd(collision)) return false;
    if (form.type === "MX") {
      const pref = Number(form.mxPreference);
      if (form.mxPreference.trim() === "" || !Number.isFinite(pref) || pref < 0) return false;
    }
    return true;
  })();

  /** The in-progress form counts as a record once a value is typed. */
  const currentCountsAsRecord = form.value.trim() !== "";
  const totalRecords = queued.length + (currentCountsAsRecord && currentRecordValid ? 1 : 0);

  /** True when the form differs from the original record being edited. */
  const hasChanges = (() => {
    if (!original) return true;
    const o = original;
    const f = form;
    if (f.type !== o.type) return true;
    if (f.value.trim() !== o.value.trim()) return true;
    if (Boolean(f.proxied) !== Boolean(o.proxied)) return true;
    const formTtl = f.ttl === "" ? undefined : Number(f.ttl);
    if (formTtl !== o.ttl) return true;
    if (f.type === "MX" || o.type === "MX") {
      if (Number(f.mxPreference) !== Number(o.mxPreference ?? 10)) return true;
    }
    return false;
  })();

  const isValid = (() => {
    if (isDelete) return true;
    if (!contactValid) return false;
    if (isEdit) return currentRecordValid && hasChanges;
    if (queued.length > 0) {
      // A half-typed record blocks submit instead of being silently dropped.
      return !currentCountsAsRecord || currentRecordValid;
    }
    return currentRecordValid;
  })();

  /**
   * The record being edited or deleted is no longer in the domain file — a pull request
   * merged (or someone committed) after this page loaded its record list. Submitting would
   * fail server-side with "No matching <TYPE> record", so block it and say so here instead.
   */
  const originalGone =
    !!original &&
    (isEdit || isDelete) &&
    !groupsPending &&
    groups.length > 0 &&
    !liveAtName.some((r) => sameRecordTarget(r, original));

  const originalFqdn = original ? `${original.subdomain}.${bare}` : null;

  const staleDetail =
    liveAtName.length === 0
      ? `There are no records left under ${originalFqdn}.`
      : liveAtName.length === 1
        ? `That name now has a single ${liveAtName[0]!.type} record (${liveAtName[0]!.value}).`
        : `That name now has ${liveAtName.length} records: ${liveAtName.map((r) => `${r.type} ${r.value}`).join(", ")}.`;

  /** Only offered for an unambiguous edit — retargeting a delete could remove the wrong record. */
  const retargetTarget = originalGone && isEdit && liveAtName.length === 1 ? liveAtName[0]! : null;

  const needsManualFork = authenticated && !authPending && !forkPending && !fork;
  const canSubmit =
    isValid &&
    !originalGone &&
    !groupsPending &&
    !sending &&
    !refreshingFork &&
    !forkPending &&
    authenticated &&
    !!fork &&
    appAccess?.accessible !== false;

  const defaultManualForkUrl = manualForkUrl || `https://github.com/${upstreamLabel}/fork`;
  const appInstallUrl = appAccess?.manageUrl || submissionInstallUrl || installUrl;
  const appAccessBlocked =
    !!appAccess && !appAccess.accessible && authenticated && !!fork && !error;
  const missingWorkflowsPermission = appAccess?.missingPermissions.includes("workflows");
  const appAccessActionLabel = missingWorkflowsPermission
    ? "Review app permissions"
    : appAccess?.installed
      ? "Add your fork to the app"
      : "Install GitHub App";

  const modalTitle = isDelete ? "Delete record" : isEdit ? "Edit record" : "Add record";

  const clearErrors = () => {
    setError(null);
    setSubmissionErrorCode(null);
    setSubmissionInstallUrl(null);
    setAppInstallNotice(null);
  };

  const checkAppAccess = useCallback(async (state: Pick<AuthState, "authenticated" | "fork">) => {
    if (!state.authenticated || !state.fork) {
      setAppAccess(null);
      return;
    }
    try {
      setAppAccess(await api<AppAccess>("/api/auth/app-access"));
    } catch {
      setAppAccess(null);
    }
  }, []);

  // Reset and prime the form each time the dialog opens.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  useEffect(() => {
    if (!show) return;
    setError(null);
    setSubmissionErrorCode(null);
    setSubmissionInstallUrl(null);
    setAppInstallNotice(null);
    setAppAccess(null);
    setStatusMessage(null);
    setDeleteFromEdit(false);

    if (editing) {
      setOriginal({ ...editing });
      setForm(formFromRecord(editing));
      setShowAdvanced(editing.ttl !== undefined);
      setMode(initialMode);
    } else {
      setOriginal(null);
      setShowAdvanced(false);
      setMode("add");
      setForm((f) => (f.contact.trim() ? f : { ...f, contact: loadContact() }));
    }
    // The record list can be minutes-to-hours stale by the time someone opens this
    // dialog; re-read it so an edit is matched against what upstream has right now.
    onRefreshRef.current();
    let cancelled = false;
    refresh().then(
      (next) => {
        if (!cancelled) void checkAppAccess(next);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // Only re-run when the dialog opens; `editing`/`initialMode` are set alongside `show`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  function resetForm() {
    setForm(emptyForm(loadContact()));
    setOriginal(null);
    setQueued([]);
    setShowAdvanced(false);
    setStatusMessage(null);
    setValueTouched(false);
    setValueFocused(false);
  }

  function close() {
    setMode(null);
    clearErrors();
    resetForm();
    onClose();
  }

  function back() {
    if (isDelete && deleteFromEdit) {
      setMode("edit");
      setDeleteFromEdit(false);
      clearErrors();
      setStatusMessage(null);
      return;
    }
    close();
  }

  function startDelete() {
    setDeleteFromEdit(true);
    clearErrors();
    setMode("delete");
  }

  function snapshotCurrentRecord(): QueuedRecord {
    return {
      subdomain: form.subdomain.trim().toLowerCase(),
      type: form.type,
      value: form.value.trim(),
      ...(form.ttl !== "" && !(form.proxied && canProxy) ? { ttl: Number(form.ttl) } : {}),
      mxPreference: Number(form.mxPreference),
      proxied: form.proxied && canProxy,
    };
  }

  function queueCurrentRecord() {
    if (!currentRecordValid) return;
    setQueued((q) => [...q, snapshotCurrentRecord()]);
    // Keep subdomain (batches often target related names) and contact; clear the rest.
    patch({ value: "", ttl: "", mxPreference: "10", proxied: false });
    setValueTouched(false);
  }

  function setType(type: string) {
    // Drop proxy when the type is not proxyable (MX/TXT/ALIAS).
    setForm((f) => ({ ...f, type, proxied: supportsCfProxy(domain, type) ? f.proxied : false }));
  }

  function applyCnamePreset(preset: (typeof CNAME_PRESETS)[number]) {
    setForm((f) => ({
      ...f,
      type: "CNAME",
      value: preset.value,
      proxied: preset.proxyByDefault && supportsCfProxy(domain, "CNAME") ? true : f.proxied,
    }));
  }

  const isCnamePresetActive = (v: string) =>
    form.type === "CNAME" &&
    form.value.trim().replace(/\.$/, "").toLowerCase() ===
      v.trim().replace(/\.$/, "").toLowerCase();

  function overwriteExisting() {
    const target = overwriteTarget;
    if (!target) return;
    setOriginal({
      subdomain: subLower,
      type: target.type,
      value: target.value,
      ttl: target.ttl,
      mxPreference: target.mxPreference,
      proxied: target.proxied,
      contact: target.contact,
    });
    setMode("edit");
    setQueued([]);
    setForm((f) => {
      const next = { ...f, subdomain: subLower };
      if (!next.contact.trim()) next.contact = target.contact?.trim() || loadContact();
      if (!next.value.trim()) {
        next.type = target.type;
        next.value = target.value;
        next.ttl = target.ttl === undefined ? "" : String(target.ttl);
        next.mxPreference = String(target.mxPreference ?? 10);
        next.proxied = target.proxied === true;
      }
      return next;
    });
    if (!form.value.trim()) setShowAdvanced(target.ttl !== undefined);
  }

  /** Point the edit at the record that actually exists, keeping whatever the user typed. */
  function retargetToLive() {
    const target = retargetTarget;
    if (!target) return;
    setOriginal({
      subdomain: subLower,
      type: target.type,
      value: target.value,
      ttl: target.ttl,
      mxPreference: target.mxPreference,
      proxied: target.proxied,
      contact: target.contact,
    });
    if (!form.contact.trim()) patch({ contact: target.contact?.trim() || loadContact() });
  }

  function startLogin() {
    login(
      isEdit
        ? `/?domain=${encodeURIComponent(domain)}`
        : `/?openAdd=1&domain=${encodeURIComponent(domain)}`,
    );
  }

  async function refreshAfterManualFork() {
    setError(null);
    setSubmissionErrorCode(null);
    setSubmissionInstallUrl(null);
    setStatusMessage("Looking for your fork…");
    setRefreshingFork(true);
    try {
      const next = await refresh();
      if (next.fork) {
        setStatusMessage(`Found fork ${next.fork.fullName}`);
        void checkAppAccess(next);
      } else {
        setStatusMessage(null);
        setError(
          `Still no fork of ${upstreamLabel} on your account. Fork it on GitHub, wait a few seconds, then try again.`,
        );
      }
    } catch {
      setStatusMessage(null);
      setError("Could not check for your fork. Try again in a moment.");
    } finally {
      setRefreshingFork(false);
    }
  }

  // GitHub App install happens in a popup; we learn it finished via postMessage from
  // /github-app-installed, the popup closing, or this window regaining focus.
  const installWindow = useRef<Window | null>(null);
  const installPoll = useRef<number | null>(null);
  const installStartedAt = useRef(0);
  const installState = useRef({ awaiting: false, checking: false });

  const stopAppInstallPoll = () => {
    if (installPoll.current) window.clearInterval(installPoll.current);
    installPoll.current = null;
  };

  const refreshAfterAppInstall = useCallback(async () => {
    const s = installState.current;
    if (!s.awaiting || s.checking) return;

    s.awaiting = false;
    s.checking = true;
    setAwaitingAppInstall(false);
    setCheckingAppInstall(true);
    stopAppInstallPoll();

    try {
      await refresh();
      const access = await api<AppAccess>("/api/auth/app-access");
      setAppAccess(access);
      if (access.accessible) {
        setError(null);
        setSubmissionErrorCode(null);
        setSubmissionInstallUrl(null);
        setAppInstallNotice(
          "GitHub App access is ready. Your changes are still here—open the pull request again.",
        );
      } else if (access.missingPermissions.includes("workflows")) {
        setError(
          "The GitHub App still needs read and write access to workflows. Approve the new permission on GitHub, then return here.",
        );
      } else {
        setError(
          "The GitHub App still cannot access your fork. Update the installation and select your DNS fork, then return here.",
        );
      }
    } catch {
      setError("Could not verify GitHub App access. Return here and try again.");
    } finally {
      s.checking = false;
      setCheckingAppInstall(false);
      scrollToTop();
    }
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      if (installState.current.awaiting && Date.now() - installStartedAt.current > 1000) {
        void refreshAfterAppInstall();
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "dns-editor:github-app-installed"
      ) {
        void refreshAfterAppInstall();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("message", onMessage);
      stopAppInstallPoll();
    };
  }, [refreshAfterAppInstall]);

  function openAppInstall() {
    const url = appInstallUrl;
    if (!url) return;

    setAppInstallNotice(null);
    installState.current.awaiting = true;
    setAwaitingAppInstall(true);
    installStartedAt.current = Date.now();
    installWindow.current = window.open(
      url,
      "dns-editor-github-app-install",
      "popup,width=760,height=760",
    );

    if (!installWindow.current) {
      installState.current.awaiting = false;
      setAwaitingAppInstall(false);
      setError("Your browser blocked the GitHub installation window. Allow pop-ups and try again.");
      return;
    }

    setError("Finish installing the GitHub App in the new window. Your changes will stay here.");
    stopAppInstallPoll();
    installPoll.current = window.setInterval(() => {
      if (installWindow.current?.closed) void refreshAfterAppInstall();
    }, 500);
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit || !fork) return;

    let body: Record<string, unknown>;
    if (isDelete && original) {
      body = {
        domain,
        action: "delete",
        record: {
          subdomain: original.subdomain,
          type: original.type,
          value: original.value,
          ...(original.type === "MX" ? { mxPreference: Number(original.mxPreference ?? 10) } : {}),
        },
      };
    } else if (isEdit && original) {
      body = {
        domain,
        action: "edit",
        record: {
          subdomain: form.subdomain.trim().toLowerCase(),
          type: form.type,
          value: form.value.trim(),
          contact: form.contact.trim(),
          ...(form.ttl !== "" && !(form.proxied && canProxy) ? { ttl: Number(form.ttl) } : {}),
          ...(form.type === "MX" ? { mxPreference: Number(form.mxPreference) } : {}),
          ...(form.proxied && canProxy ? { proxied: true } : {}),
        },
        original: {
          type: original.type,
          value: original.value,
          ...(original.type === "MX" ? { mxPreference: Number(original.mxPreference ?? 10) } : {}),
        },
      };
    } else {
      const records = [
        ...queued,
        ...(currentCountsAsRecord && currentRecordValid ? [snapshotCurrentRecord()] : []),
      ].map((r) => ({
        subdomain: r.subdomain,
        type: r.type,
        value: r.value,
        ...(r.ttl !== undefined ? { ttl: r.ttl } : {}),
        ...(r.type === "MX" ? { mxPreference: r.mxPreference } : {}),
        ...(r.proxied ? { proxied: true } : {}),
      }));
      body = { domain, action: "add", contact: form.contact.trim(), records };
    }

    try {
      clearErrors();
      setSending(true);
      setStatusMessage(`Opening PR via ${fork.fullName}…`);

      const response = await api<SubmitResponse>("/api/submit", { method: "POST", body });

      saveContact(form.contact.trim());
      close();
      setSuccess({ prUrl: response.prUrl, needsManualPr: response.needsManualPr === true });
      await refresh().catch(() => undefined);
    } catch (err) {
      const code = errCode(err);
      setSubmissionErrorCode(code);
      setSubmissionInstallUrl(errInstallUrl(err));
      setError(
        code === "AUTH_REQUIRED"
          ? "Sign in with GitHub to open a pull request."
          : code === "INVALID_TOKEN_TYPE"
            ? "Your session is not a GitHub App user token (ghu_). Sign out and sign in again with the GitHub App."
            : code === "FORK_REQUIRED"
              ? `You need a fork of ${upstreamLabel} on your account first.`
              : code === "APP_WORKFLOWS_PERMISSION_REQUIRED"
                ? "The GitHub App needs read and write access to workflows before it can sync your fork."
                : code === "APP_INSTALL_REQUIRED"
                  ? "The GitHub App needs access to your fork before it can push this change."
                  : err instanceof Error
                    ? err.message
                    : "Failed to submit record",
      );
      setStatusMessage(null);
      scrollToTop();
    } finally {
      setSending(false);
    }
  }

  const valuePlaceholder =
    form.type === "CNAME" || form.type === "ALIAS"
      ? "cname.vercel-dns.com."
      : form.type === "A"
        ? "1.2.3.4"
        : form.type === "MX"
          ? "aspmx.l.google.com."
          : "record value";

  const appInstallButton = appInstallUrl && (
    <Button
      variant="primary"
      size="sm"
      loading={checkingAppInstall}
      disabled={awaitingAppInstall || checkingAppInstall}
      onClick={openAppInstall}
    >
      {checkingAppInstall ? "Checking access…" : appAccessActionLabel}
    </Button>
  );

  const busy = sending || refreshingFork;

  return (
    <>
      <Dialog.Root open={show} onOpenChange={(o) => !o && close()}>
        <Dialog
          size="xl"
          className="flex max-h-[calc(100dvh-4rem)] max-w-[min(42rem,calc(100vw-2rem))] flex-col sm:max-h-[calc(100dvh-8rem)]"
        >
          {busy && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-kumo-base/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 px-4 text-center">
                <Loader size="lg" />
                <span className="text-sm">{statusMessage || "Working…"}</span>
              </div>
            </div>
          )}

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <div className="flex items-center justify-between gap-4 border-b border-kumo-hairline px-5 py-4">
              <Dialog.Title className="text-xl font-semibold">{modalTitle}</Dialog.Title>
              <Dialog.Close
                aria-label="Close dialog"
                render={(props) => (
                  <Button
                    {...props}
                    variant="ghost"
                    shape="square"
                    icon={XIcon}
                    aria-label="Close dialog"
                  />
                )}
              />
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5"
            >
              {needsHqApproval && !isEdit && !isDelete && (
                <Banner
                  variant="alert"
                  size="sm"
                  icon={<WarningIcon weight="fill" />}
                  description="Changes to this domain need HQ approval. Only continue if you already have the green light."
                />
              )}

              {appInstallNotice && (
                <Banner
                  size="sm"
                  icon={<InfoIcon weight="fill" />}
                  description={appInstallNotice}
                />
              )}

              {appAccessBlocked && (
                <Banner
                  variant="error"
                  icon={<WarningCircleIcon weight="fill" />}
                  description={
                    missingWorkflowsPermission ? (
                      "The GitHub App is installed but does not have read and write access to workflows. Approve the new permission on GitHub before submitting."
                    ) : appAccess?.installed ? (
                      <>
                        The GitHub App is installed but can&apos;t push to your fork{" "}
                        <code className="font-mono">{fork?.fullName}</code>. Add your fork to the
                        app&apos;s repositories, then submit.
                      </>
                    ) : (
                      "The GitHub App isn't set up to push to your fork yet. Install it on your account so it can open the pull request."
                    )
                  }
                  action={appInstallButton}
                />
              )}

              {error && (
                <Banner
                  variant="error"
                  icon={<WarningCircleIcon weight="fill" />}
                  description={error}
                  action={
                    (submissionErrorCode === "APP_INSTALL_REQUIRED" ||
                      submissionErrorCode === "APP_WORKFLOWS_PERMISSION_REQUIRED") &&
                    appInstallButton
                  }
                />
              )}

              {originalGone && original && (
                <Banner
                  variant="error"
                  icon={<WarningCircleIcon weight="fill" />}
                  title="This record changed upstream"
                  description={
                    <>
                      The <strong>{original.type}</strong> record ({original.value}) under{" "}
                      <code className="font-mono">{originalFqdn}</code> is no longer in{" "}
                      {upstreamLabel} — it changed after this page loaded its record list.{" "}
                      {staleDetail}
                    </>
                  }
                  action={
                    <>
                      {retargetTarget && (
                        <Button variant="primary" size="sm" onClick={retargetToLive}>
                          Edit the {retargetTarget.type} record instead
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={groupsPending}
                        disabled={groupsPending}
                        onClick={onRefresh}
                      >
                        {groupsPending ? "Reloading…" : "Reload records"}
                      </Button>
                    </>
                  }
                />
              )}

              <AccountPanel
                authPending={authPending}
                forkPending={forkPending}
                authenticated={authenticated}
                user={user}
                fork={fork}
                upstreamLabel={upstreamLabel}
                needsManualFork={needsManualFork}
                manualForkUrl={defaultManualForkUrl}
                installUrl={installUrl}
                refreshingFork={refreshingFork}
                onLogin={startLogin}
                onRefreshFork={refreshAfterManualFork}
                onInstallApp={openAppInstall}
              />

              {isDelete && (
                <Banner
                  variant="error"
                  icon={<WarningIcon weight="fill" />}
                  description={
                    <>
                      Delete <strong>{form.type}</strong> record <strong>{previewName}</strong>
                      {previewValue && (
                        <>
                          {" "}
                          → <strong>{previewValue}</strong>
                        </>
                      )}
                      ? This opens a pull request to {upstreamLabel} that removes it once merged.
                    </>
                  }
                />
              )}

              {!isDelete && (
                <>
                  {!isEdit && queued.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-medium">Queued records ({queued.length})</p>
                      <ul className="space-y-1.5">
                        {queued.map((q, i) => (
                          <li
                            key={`${q.type}-${q.subdomain}-${q.value}-${i}`}
                            className="flex items-center gap-2 rounded-lg bg-kumo-elevated px-3 py-2 text-sm ring ring-kumo-hairline"
                          >
                            <Badge variant="blue">{q.type}</Badge>
                            <span className="shrink-0 truncate">
                              {q.subdomain}.{bare}
                            </span>
                            <ArrowRightIcon className="size-4 shrink-0 text-kumo-subtle" />
                            <span
                              className="min-w-0 flex-1 truncate text-kumo-subtle"
                              title={q.value}
                            >
                              {q.value}
                            </span>
                            {q.proxied && <Badge variant="orange">Proxied</Badge>}
                            {q.ttl !== undefined && <Badge variant="neutral">TTL {q.ttl}</Badge>}
                            <Button
                              variant="ghost"
                              size="xs"
                              shape="square"
                              icon={XIcon}
                              aria-label={`Remove queued ${q.type} record for ${q.subdomain}.${bare}`}
                              onClick={() => setQueued((qs) => qs.filter((_, j) => j !== i))}
                            />
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-kumo-subtle">
                        All queued records go into a single pull request.
                      </p>
                    </div>
                  )}

                  {(isEdit || queued.length === 0 || currentCountsAsRecord) && (
                    <p className="hidden text-base break-words sm:block">
                      {isEdit && "Update "}
                      <span className={previewName ? "" : "text-kumo-subtle"}>
                        {previewName ?? "[name]"}
                      </span>{" "}
                      {previewVerb}{" "}
                      <span className={previewValue ? "" : "text-kumo-subtle"}>
                        {previewValue ?? "[value]"}
                      </span>
                      {proxySuffix} via a pull request on {upstreamLabel}.
                    </p>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="w-full shrink-0 sm:w-28">
                      <Select
                        label="Type"
                        className="w-full"
                        value={form.type}
                        onValueChange={(v) => v && setType(String(v))}
                      >
                        {RECORD_TYPES.map((t) => (
                          <Select.Option key={t} value={t}>
                            {t}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>

                    <div className="min-w-0 flex-1">
                      <InputGroup
                        label="Name"
                        disabled={isEdit}
                        description={isEdit ? "Name can't be changed here." : undefined}
                      >
                        <InputGroup.Input
                          aria-label="Name"
                          value={form.subdomain}
                          onChange={(e) => patch({ subdomain: e.target.value })}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="coolsubdomain"
                          title={isEdit ? "Subdomain cannot be changed when editing" : undefined}
                        />
                        <InputGroup.Suffix>.{bare}</InputGroup.Suffix>
                      </InputGroup>
                    </div>
                  </div>

                  {collision && collisionMessage && (
                    <Banner
                      variant="alert"
                      size="sm"
                      icon={<WarningIcon weight="fill" />}
                      description={
                        canOverwrite || queued.length === 0
                          ? collisionMessage
                          : `${collisionMessage} Remove the queued record for this name, or pick a different name.`
                      }
                      action={
                        canOverwrite && (
                          <Banner.Action onClick={overwriteExisting}>
                            Overwrite existing record
                          </Banner.Action>
                        )
                      }
                    />
                  )}

                  {isEdit && original && (
                    <p className="text-xs text-kumo-subtle">
                      This pull request will replace the existing{" "}
                      <span className="font-medium text-kumo-default">{original.type}</span> record
                      ({original.value}).
                    </p>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <Input
                        label={form.type === "MX" ? "Exchange" : "Value"}
                        value={form.value}
                        onChange={(e) => patch({ value: e.target.value })}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder={valuePlaceholder}
                        variant={showValueError ? "error" : "default"}
                        error={showValueError ? (valueError ?? undefined) : undefined}
                        onFocus={() => setValueFocused(true)}
                        onBlur={() => {
                          setValueFocused(false);
                          setValueTouched(true);
                        }}
                      />

                      {form.type === "CNAME" && (
                        <div
                          className="mt-2 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label="Common CNAME targets"
                        >
                          {CNAME_PRESETS.map((preset) => (
                            <Button
                              key={preset.id}
                              size="xs"
                              variant={isCnamePresetActive(preset.value) ? "primary" : "secondary"}
                              title={preset.value}
                              aria-pressed={isCnamePresetActive(preset.value)}
                              onClick={() => applyCnamePreset(preset)}
                            >
                              <ProviderIcon provider={preset.id} />
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>

                    {form.type === "MX" && (
                      <div className="w-full shrink-0 sm:w-28">
                        <Input
                          label="Priority"
                          type="number"
                          min={0}
                          value={form.mxPreference}
                          onChange={(e) => patch({ mxPreference: e.target.value })}
                        />
                      </div>
                    )}

                    {showProxyToggle && canProxy && (
                      <div className="shrink-0 sm:pt-7">
                        <Switch
                          checked={form.proxied}
                          onCheckedChange={(proxied) => patch({ proxied })}
                          title={
                            form.proxied
                              ? "Traffic is proxied through Cloudflare (orange cloud)"
                              : "DNS only — not proxied through Cloudflare"
                          }
                          label={
                            <span className="inline-flex items-center gap-1.5">
                              <CloudIcon
                                weight={form.proxied ? "fill" : "regular"}
                                className={
                                  form.proxied
                                    ? "size-4 text-kumo-brand"
                                    : "size-4 text-kumo-subtle"
                                }
                              />
                              {form.proxied ? "Proxied" : "DNS only"}
                            </span>
                          }
                        />
                      </div>
                    )}
                  </div>

                  <Input
                    label="Contact"
                    value={form.contact}
                    onChange={(e) => patch({ contact: e.target.value })}
                    autoComplete="off"
                    placeholder="you@example.com U012AB345CD"
                    description={`Required by ${upstreamLabel} CI — email and/or Slack member ID.`}
                  />

                  <Collapsible.Root open={showAdvanced} onOpenChange={setShowAdvanced}>
                    <Collapsible.DefaultTrigger>Record attributes</Collapsible.DefaultTrigger>
                    <Collapsible.DefaultPanel>
                      <Input
                        label="TTL"
                        type="number"
                        min={1}
                        value={form.proxied && canProxy ? "" : form.ttl}
                        onChange={(e) => patch({ ttl: e.target.value })}
                        placeholder={form.proxied && canProxy ? "Auto" : "Leave empty for default"}
                        disabled={form.proxied && canProxy}
                        description={
                          form.proxied && canProxy
                            ? "TTL is Auto while Cloudflare proxy is on."
                            : "Only set this if you need a custom TTL."
                        }
                      />
                    </Collapsible.DefaultPanel>
                  </Collapsible.Root>
                </>
              )}
            </div>

            <div className="border-t border-kumo-hairline px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {isEdit && !hasChanges && (
                <p className="mb-2 text-xs text-kumo-subtle">
                  Change at least one field to open a pull request.
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" disabled={busy} onClick={back}>
                  Cancel
                </Button>
                {!isEdit && !isDelete && (
                  <Button
                    variant="secondary"
                    disabled={!currentRecordValid || busy}
                    title="Queue this record and add another one to the same pull request"
                    onClick={queueCurrentRecord}
                  >
                    Add another
                  </Button>
                )}
                {isEdit && (
                  <Button variant="secondary-destructive" disabled={busy} onClick={startDelete}>
                    Delete record
                  </Button>
                )}
                {isDelete ? (
                  <Button type="submit" variant="destructive" disabled={!canSubmit}>
                    Delete record
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    icon={GithubLogoIcon}
                    disabled={!canSubmit}
                  >
                    Open Pull Request
                    {!isEdit && totalRecords > 1 ? ` (${totalRecords} records)` : ""}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Dialog>
      </Dialog.Root>

      <SuccessDialog
        open={!!success}
        prUrl={success?.prUrl}
        needsManualPr={success?.needsManualPr}
        onClose={() => setSuccess(null)}
      />
    </>
  );
}

function AccountPanel({
  authPending,
  forkPending,
  authenticated,
  user,
  fork,
  upstreamLabel,
  needsManualFork,
  manualForkUrl,
  installUrl,
  refreshingFork,
  onLogin,
  onRefreshFork,
  onInstallApp,
}: {
  authPending: boolean;
  forkPending: boolean;
  authenticated: boolean;
  user: AuthState["user"];
  fork: AuthState["fork"];
  upstreamLabel: string;
  needsManualFork: boolean;
  manualForkUrl: string;
  installUrl: string | null;
  refreshingFork: boolean;
  onLogin: () => void;
  onRefreshFork: () => void;
  onInstallApp: () => void;
}) {
  let body: React.ReactNode;

  if (authPending || forkPending) {
    body = (
      <p className="flex items-center gap-2 text-kumo-subtle">
        <Loader size="sm" />
        {authPending ? "Checking GitHub sign-in…" : "Looking for your fork…"}
      </p>
    );
  } else if (!authenticated) {
    body = (
      <>
        <p>
          Sign in with GitHub so the pull request is opened as <strong>you</strong>.
        </p>
        <Button variant="primary" icon={GithubLogoIcon} className="mt-3" onClick={onLogin}>
          Sign in with GitHub
        </Button>
      </>
    );
  } else {
    body = (
      <div className="flex items-start gap-2.5">
        {user?.avatarUrl && (
          // oxlint-disable-next-line nextjs/no-img-element -- tiny avatar, no optimisation needed
          <img
            src={user.avatarUrl}
            alt=""
            width={28}
            height={28}
            className="mt-0.5 size-7 rounded-full"
          />
        )}
        <div className="min-w-0 flex-1">
          <p>
            Signed in as <strong className="font-medium">@{user?.login}</strong>
          </p>

          {fork ? (
            <p className="mt-1 text-kumo-subtle">
              Using your fork{" "}
              <Link href={fork.htmlUrl} target="_blank" rel="noreferrer">
                {fork.fullName}
              </Link>{" "}
              → PR to <code className="font-mono text-kumo-default">{upstreamLabel}</code>
            </p>
          ) : (
            needsManualFork && (
              <div className="mt-2 space-y-3">
                <p className="text-kumo-subtle">
                  We need a fork of{" "}
                  <code className="font-mono text-kumo-default">{upstreamLabel}</code> under your
                  account. Fork it on GitHub (one click), then come back here.
                </p>
                <div className="flex flex-wrap gap-2">
                  <LinkButton
                    href={manualForkUrl}
                    target="_blank"
                    rel="noreferrer"
                    variant="primary"
                    size="sm"
                  >
                    Fork on GitHub
                  </LinkButton>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={refreshingFork}
                    onClick={onRefreshFork}
                  >
                    I forked it — refresh
                  </Button>
                </div>
                {installUrl && (
                  <p className="text-xs text-kumo-subtle">
                    After forking, if submit fails with a permission error, also{" "}
                    <button
                      type="button"
                      className="text-kumo-link hover:underline"
                      onClick={onInstallApp}
                    >
                      install the app
                    </button>{" "}
                    on your account so it can push branches to your fork.
                  </p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-kumo-elevated p-3 text-sm ring ring-kumo-hairline">{body}</div>
  );
}
