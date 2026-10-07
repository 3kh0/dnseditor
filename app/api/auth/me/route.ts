import {
  createUserOctokit,
  findUserFork,
  getInstallUrl,
  getManualForkUrl,
  getUpstreamRepo,
  githubErrorMessage,
  requireUserSession,
} from "@/lib/server/github";
import { route } from "@/lib/server/http";
import { getAppSession } from "@/lib/server/session";

export const GET = route(async (ctx) => {
  const includeFork = ctx.query("includeFork") === "1";
  const upstream = getUpstreamRepo();
  const installUrl = getInstallUrl();
  const manualForkUrl = getManualForkUrl(upstream.owner, upstream.repo);
  const upstreamPayload = {
    owner: upstream.owner,
    repo: upstream.repo,
    fullName: `${upstream.owner}/${upstream.repo}`,
    branch: upstream.branch,
  };

  const empty = {
    authenticated: false as const,
    user: null,
    fork: null,
    upstream: upstreamPayload,
    installUrl,
    manualForkUrl,
  };

  ctx.headers.set("Cache-Control", "private, no-store");

  if (!getAppSession(ctx)) return empty;

  let s;
  try {
    s = await requireUserSession(ctx);
  } catch (e) {
    return { ...empty, error: githubErrorMessage(e) };
  }

  const signedIn = {
    authenticated: true as const,
    user: { login: s.login, name: s.name ?? null, avatarUrl: s.avatarUrl ?? null },
    fork: null,
    upstream: upstreamPayload,
    installUrl,
    manualForkUrl,
  };

  if (!includeFork) return signedIn;

  try {
    const fork = await findUserFork(
      createUserOctokit(s.accessToken),
      s.login,
      upstream.owner,
      upstream.repo,
    );

    return {
      ...signedIn,
      fork: fork
        ? { owner: fork.owner, repo: fork.repo, fullName: fork.fullName, htmlUrl: fork.htmlUrl }
        : null,
    };
  } catch (e) {
    if (isUnauthorized(e)) return { ...empty, error: githubErrorMessage(e) };
    return { ...signedIn, fork: null, error: githubErrorMessage(e) };
  }
});

const isUnauthorized = (e: unknown) =>
  typeof e === "object" && e !== null && "status" in e && (e as { status: number }).status === 401;
