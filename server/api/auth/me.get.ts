import {
  createUserOctokit,
  findUserFork,
  getInstallUrl,
  getManualForkUrl,
  getUpstreamRepo,
  githubErrorMessage,
  requireUserSession,
} from "../../utils/github";
import { getAppSession } from "../../utils/session";

export default defineEventHandler(async (event) => {
  const upstream = getUpstreamRepo(event);
  const installUrl = getInstallUrl(event);
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

  setResponseHeader(event, "Cache-Control", "private, no-store");

  if (!getAppSession(event)) return empty;

  let s;
  try {
    s = await requireUserSession(event);
  } catch (e) {
    return { ...empty, error: githubErrorMessage(e) };
  }

  const signedIn = {
    authenticated: true as const,
    user: { login: s.login, name: s.name ?? null, avatarUrl: s.avatarUrl ?? null },
    upstream: upstreamPayload,
    installUrl,
    manualForkUrl,
  };

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
