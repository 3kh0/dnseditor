"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

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

const EMPTY: AuthState = {
  authenticated: false,
  user: null,
  fork: null,
  upstream: null,
  installUrl: null,
  manualForkUrl: null,
};

interface AuthContextValue extends AuthState {
  pending: boolean;
  forkPending: boolean;
  /** Re-reads the session including the user's fork; resolves with the new state. */
  refresh(): Promise<AuthState>;
  login(returnTo?: string): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AuthState>(EMPTY);
  const [pending, setPending] = useState(true);
  const [forkPending, setForkPending] = useState(false);

  const load = useCallback(
    () =>
      api<AuthState>("/api/auth/me")
        .catch(() => EMPTY)
        .then((next) => {
          setData(next);
          setPending(false);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setForkPending(true);
    try {
      const next = await api<AuthState>("/api/auth/me?includeFork=1");
      setData(next);
      return next;
    } finally {
      setForkPending(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...data,
      pending,
      forkPending,
      refresh,
      login(returnTo = "/") {
        const path = returnTo.startsWith("/") ? returnTo : "/";
        window.location.href = `/api/auth/github?returnTo=${encodeURIComponent(path)}`;
      },
      async logout() {
        await api("/api/auth/logout", { method: "POST" });
        await load();
      },
    }),
    [data, pending, forkPending, refresh, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
