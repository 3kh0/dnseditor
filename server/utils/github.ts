import { Octokit } from "@octokit/rest";
import type { H3Event } from "h3";
import type { SessionData } from "./session";
import { getAppSession, setAppSessionCookie } from "./session";

export interface UpstreamRepo {
  owner: string;
  repo: string;
  branch: string;
}

export interface ForkInfo {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
}

export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  appSlug?: string;
}

export interface AppBotIdentity {
  login: string;
  name: string;
  email: string;
  htmlUrl: string;
}

const env = (...keys: string[]) => {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return "";
};

const str = (v: unknown, fallback = "") => String(v || fallback);

export function getUpstreamRepo(event: H3Event): UpstreamRepo {
  const c = useRuntimeConfig(event);
  return {
    owner: str(c.dnsGithubOwner || env("NUXT_DNS_GITHUB_OWNER", "DNS_GITHUB_OWNER"), "hackclub"),
    repo: str(c.dnsGithubRepo || env("NUXT_DNS_GITHUB_REPO", "DNS_GITHUB_REPO"), "dns"),
    branch: str(c.dnsGithubBranch || env("NUXT_DNS_GITHUB_BRANCH", "DNS_GITHUB_BRANCH"), "main"),
  };
}

export function getGitHubAppConfig(event: H3Event): GitHubAppConfig {
  const c = useRuntimeConfig(event);
  const clientId = str(
    c.githubAppClientId || env("NUXT_GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_ID"),
  );
  const clientSecret = str(
    c.githubAppClientSecret || env("NUXT_GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_CLIENT_SECRET"),
  );
  const appSlug =
    str(c.githubAppSlug || env("NUXT_GITHUB_APP_SLUG", "GITHUB_APP_SLUG")) || undefined;

  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      message:
        "Server is missing GitHub App credentials (GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET)",
    });
  }
  return { clientId, clientSecret, appSlug };
}

export function getInstallUrl(event: H3Event): string | null {
  try {
    const { appSlug } = getGitHubAppConfig(event);
    return appSlug ? `https://github.com/apps/${appSlug}/installations/new?state=dns-editor` : null;
  } catch {
    return null;
  }
}

export const getManualForkUrl = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/fork`;

export const getInstallationManageUrl = (installationId: number) =>
  `https://github.com/settings/installations/${installationId}`;

export async function getAppBotIdentity(
  octokit: Octokit,
  event: H3Event,
): Promise<AppBotIdentity | null> {
  let appSlug: string | undefined;
  try {
    appSlug = getGitHubAppConfig(event).appSlug;
  } catch {
    appSlug = env("NUXT_GITHUB_APP_SLUG", "GITHUB_APP_SLUG") || undefined;
  }
  if (!appSlug) return null;

  const login = `${appSlug}[bot]`;
  try {
    const { data } = await octokit.users.getByUsername({ username: login });
    return {
      login: data.login,
      name: data.name || data.login,
      email: `${data.id}+${data.login}@users.noreply.github.com`,
      htmlUrl: data.html_url,
    };
  } catch (e) {
    console.warn("Could not resolve app bot user:", githubErrorMessage(e));
    return {
      login,
      name: login,
      email: `${login}@users.noreply.github.com`,
      htmlUrl: `https://github.com/apps/${appSlug}`,
    };
  }
}

export function formatCommitMessageWithBotCoAuthor(
  subject: string,
  bot: AppBotIdentity | null,
  extraBody?: string,
): string {
  const parts = [subject];
  if (extraBody?.trim()) parts.push("", extraBody.trim());
  if (bot) parts.push("", `Co-authored-by: ${bot.name} <${bot.email}>`);
  return parts.join("\n");
}

export function getAppBaseUrl(event: H3Event): string {
  const c = useRuntimeConfig(event);
  const configured = str(c.public?.appUrl || process.env.NUXT_PUBLIC_APP_URL).replace(/\/$/, "");
  if (configured) return configured;
  const url = getRequestURL(event);
  return `${url.protocol}//${url.host}`;
}

export function createUserOctokit(accessToken: string) {
  assertGitHubAppUserAccessToken(accessToken);
  return new Octokit({ auth: accessToken, userAgent: "hack-club-dns-editor" });
}

export function assertGitHubAppUserAccessToken(token: string): void {
  if (!token.startsWith("ghu_")) {
    throw createError({
      statusCode: 401,
      message:
        "Expected a GitHub App user access token (ghu_…). " +
        "Sign in again using a GitHub App Client ID — not a classic OAuth App or PAT.",
      data: { code: "INVALID_TOKEN_TYPE" },
    });
  }
}

type TokenRes = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

async function oauthToken(body: Record<string, string>): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshTokenExpiresIn?: number;
}> {
  const res = await $fetch<TokenRes>("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });

  if (res.error || !res.access_token) {
    throw createError({
      statusCode: body.grant_type === "refresh_token" ? 401 : 400,
      message: res.error_description || res.error || "Failed to exchange OAuth code",
    });
  }

  assertGitHubAppUserAccessToken(res.access_token);
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresIn: res.expires_in,
    refreshTokenExpiresIn: res.refresh_token_expires_in,
  };
}

export async function exchangeOAuthCode(event: H3Event, code: string, codeVerifier?: string) {
  const { clientId, clientSecret } = getGitHubAppConfig(event);
  const body: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: `${getAppBaseUrl(event)}/api/auth/callback`,
  };
  if (codeVerifier) body.code_verifier = codeVerifier;
  return oauthToken(body);
}

export async function refreshUserAccessToken(event: H3Event, refreshToken: string) {
  const { clientId, clientSecret } = getGitHubAppConfig(event);
  return oauthToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function forceRefreshSession(
  event: H3Event,
  session: SessionData,
): Promise<SessionData | null> {
  if (!session.refreshToken) return null;
  try {
    const r = await refreshUserAccessToken(event, session.refreshToken);
    const next: SessionData = {
      ...session,
      accessToken: r.accessToken,
      refreshToken: r.refreshToken ?? session.refreshToken,
      expiresAt: r.expiresIn ? Date.now() + r.expiresIn * 1000 : session.expiresAt,
    };
    setAppSessionCookie(event, next);
    return next;
  } catch (e) {
    console.warn(`[auth] force token refresh failed: ${githubErrorMessage(e)}`);
    return null;
  }
}

export async function requireUserSession(event: H3Event): Promise<SessionData> {
  const session = getAppSession(event);
  if (!session) {
    throw createError({
      statusCode: 401,
      message: "Sign in with GitHub to open a pull request",
      data: { code: "AUTH_REQUIRED" },
    });
  }

  try {
    assertGitHubAppUserAccessToken(session.accessToken);
  } catch {
    throw createError({
      statusCode: 401,
      message: "Your session is not a GitHub App user token. Sign out and sign in again.",
      data: { code: "INVALID_TOKEN_TYPE" },
    });
  }

  const needsRefresh =
    typeof session.expiresAt === "number" &&
    session.expiresAt - Date.now() < 5 * 60 * 1000 &&
    !!session.refreshToken;

  if (!needsRefresh) return session;

  try {
    const r = await refreshUserAccessToken(event, session.refreshToken!);
    const next: SessionData = {
      ...session,
      accessToken: r.accessToken,
      refreshToken: r.refreshToken ?? session.refreshToken,
      expiresAt: r.expiresIn ? Date.now() + r.expiresIn * 1000 : session.expiresAt,
    };
    setAppSessionCookie(event, next);
    return next;
  } catch {
    throw createError({
      statusCode: 401,
      message: "GitHub session expired. Sign in again.",
      data: { code: "AUTH_REQUIRED" },
    });
  }
}

export async function fetchGitHubUser(accessToken: string) {
  const { data } = await createUserOctokit(accessToken).users.getAuthenticated();
  return { login: data.login, name: data.name, avatarUrl: data.avatar_url };
}

function isForkOf(
  repo: {
    fork?: boolean;
    parent?: { full_name?: string } | null;
    source?: { full_name?: string } | null;
  },
  owner: string,
  name: string,
) {
  if (!repo.fork) return false;
  const target = `${owner}/${name}`.toLowerCase();
  return (
    repo.parent?.full_name?.toLowerCase() === target ||
    repo.source?.full_name?.toLowerCase() === target
  );
}

const toFork = (data: {
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  owner: { login: string };
}): ForkInfo => ({
  owner: data.owner.login,
  repo: data.name,
  fullName: data.full_name,
  htmlUrl: data.html_url,
  defaultBranch: data.default_branch,
});

export async function findUserFork(
  octokit: Octokit,
  login: string,
  upstreamOwner: string,
  upstreamRepo: string,
): Promise<ForkInfo | null> {
  try {
    const { data } = await octokit.repos.get({ owner: login, repo: upstreamRepo });
    if (isForkOf(data, upstreamOwner, upstreamRepo)) return toFork(data);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }

  try {
    const { data } = await octokit.search.repos({
      q: `user:${login} fork:only ${upstreamRepo}`,
      per_page: 10,
    });
    for (const item of data.items) {
      try {
        const { data: full } = await octokit.repos.get({
          owner: item.owner?.login || login,
          repo: item.name,
        });
        if (isForkOf(full, upstreamOwner, upstreamRepo)) return toFork(full);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* search rate limit */
  }

  try {
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      affiliation: "owner",
      sort: "updated",
      per_page: 100,
    });
    for (const repo of repos) {
      if (!repo.fork) continue;
      try {
        const { data: full } = await octokit.repos.get({
          owner: repo.owner.login,
          repo: repo.name,
        });
        if (isForkOf(full, upstreamOwner, upstreamRepo)) return toFork(full);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

export async function requireUserFork(
  octokit: Octokit,
  login: string,
  upstreamOwner: string,
  upstreamRepo: string,
): Promise<ForkInfo> {
  const existing = await findUserFork(octokit, login, upstreamOwner, upstreamRepo);
  if (existing) return existing;

  throw createError({
    statusCode: 409,
    message: `No fork of ${upstreamOwner}/${upstreamRepo} found on your account. Fork it on GitHub first, then try again.`,
    data: {
      code: "FORK_REQUIRED",
      upstream: `${upstreamOwner}/${upstreamRepo}`,
      manualForkUrl: getManualForkUrl(upstreamOwner, upstreamRepo),
    },
  });
}

export async function syncForkWithUpstream(octokit: Octokit, fork: ForkInfo, branch: string) {
  try {
    await octokit.request("POST /repos/{owner}/{repo}/merge-upstream", {
      owner: fork.owner,
      repo: fork.repo,
      branch,
    });
    console.log(`[sync] merge-upstream ok for ${fork.fullName}#${branch}`);
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e
        ? (e as { status?: number }).status
        : undefined;
    console.warn(
      `[sync] merge-upstream skipped/failed for ${fork.fullName}#${branch} (status ${status ?? "?"}): ${githubErrorMessage(e)}`,
    );
  }
}

export async function createBranchOnFork(
  octokit: Octokit,
  fork: ForkInfo,
  branch: string,
  sha: string,
  upstreamDefaultBranch: string,
) {
  try {
    await octokit.git.createRef({
      owner: fork.owner,
      repo: fork.repo,
      ref: `refs/heads/${branch}`,
      sha,
    });
  } catch (e) {
    const msg = githubErrorMessage(e);
    const missing =
      /does not exist|not found|Object not found|Reference update failed/i.test(msg) ||
      (typeof e === "object" &&
        e !== null &&
        "status" in e &&
        (e as { status: number }).status === 422);

    if (!missing) throw e;
    await syncForkWithUpstream(octokit, fork, fork.defaultBranch || upstreamDefaultBranch);
    await octokit.git.createRef({
      owner: fork.owner,
      repo: fork.repo,
      ref: `refs/heads/${branch}`,
      sha,
    });
  }
}

const isNotFound = (e: unknown) =>
  typeof e === "object" && e !== null && "status" in e && (e as { status: number }).status === 404;

export function isIntegrationAccessError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const status = (e as { status?: number }).status;
  return status === 403 && /resource not accessible by integration/i.test(githubErrorMessage(e));
}

export function githubErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      response?: { data?: { message?: string; errors?: Array<{ message?: string }> } };
    };
    const api = err.response?.data?.message;
    const details = err.response?.data?.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join("; ");
    if (api && details) return `${api}: ${details}`;
    if (api) return api;
    if (err.message) return err.message;
  }
  return error instanceof Error ? error.message : "Unknown GitHub API error";
}
