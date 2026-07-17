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

  if (!getAppSession(event)) return empty;

  try {
    const s = await requireUserSession(event);
    const fork = await findUserFork(
      createUserOctokit(s.accessToken),
      s.login,
      upstream.owner,
      upstream.repo,
    );

    return {
      authenticated: true as const,
      user: { login: s.login, name: s.name ?? null, avatarUrl: s.avatarUrl ?? null },
      fork: fork
        ? { owner: fork.owner, repo: fork.repo, fullName: fork.fullName, htmlUrl: fork.htmlUrl }
        : null,
      upstream: upstreamPayload,
      installUrl,
      manualForkUrl,
    };
  } catch (e) {
    return { ...empty, error: githubErrorMessage(e) };
  }
});
