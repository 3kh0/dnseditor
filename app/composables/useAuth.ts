import { appendResponseHeader } from "h3";

export interface AuthUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthFork {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
}

export interface AuthUpstream {
  owner: string;
  repo: string;
  fullName?: string;
  branch?: string;
}

export interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
  fork: AuthFork | null;
  upstream: AuthUpstream | null;
  installUrl: string | null;
  manualForkUrl: string | null;
  error?: string;
}

export function useAuth() {
  const ssrEvent = import.meta.server ? useRequestEvent() : null;
  const forkPending = useState("auth-fork-pending", () => false);

  const {
    data,
    pending,
    error,
    refresh: refreshSession,
  } = useFetch<AuthState>("/api/auth/me", {
    key: "auth-me",
    onResponse({ response }) {
      if (!ssrEvent) return;
      for (const cookie of response.headers.getSetCookie()) {
        appendResponseHeader(ssrEvent, "set-cookie", cookie);
      }
    },
    default: () => ({
      authenticated: false,
      user: null,
      fork: null,
      upstream: null,
      installUrl: null,
      manualForkUrl: null,
    }),
  });

  const pick = <T>(fn: (s: AuthState) => T) => computed(() => (data.value ? fn(data.value) : null));

  return {
    data,
    pending,
    forkPending: readonly(forkPending),
    error,
    async refresh() {
      forkPending.value = true;
      try {
        data.value = await $fetch<AuthState>("/api/auth/me?includeFork=1");
      } finally {
        forkPending.value = false;
      }
    },
    authenticated: computed(() => data.value?.authenticated === true),
    user: pick((s) => s.user),
    fork: pick((s) => s.fork),
    upstream: pick((s) => s.upstream),
    installUrl: pick((s) => s.installUrl),
    manualForkUrl: pick((s) => s.manualForkUrl),
    login(returnTo = "/") {
      const path = returnTo.startsWith("/") ? returnTo : "/";
      window.location.href = `/api/auth/github?returnTo=${encodeURIComponent(path)}`;
    },
    async logout() {
      await $fetch("/api/auth/logout", { method: "POST" });
      await refreshSession();
    },
  };
}
