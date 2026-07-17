import {
  createUserOctokit,
  findUserFork,
  getGitHubAppConfig,
  getUpstreamRepo,
  requireUserSession,
} from "../../utils/github";

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const upstream = getUpstreamRepo(event);
  const appSlug = getGitHubAppConfig(event).appSlug;
  const octokit = createUserOctokit(session.accessToken);
  const fork = await findUserFork(octokit, session.login, upstream.owner, upstream.repo);

  if (!fork || !appSlug) return { accessible: false };

  const { data } = await octokit.apps.listInstallationsForAuthenticatedUser({ per_page: 100 });
  const installation = data.installations.find(
    (item) =>
      item.app_slug?.toLowerCase() === appSlug.toLowerCase() &&
      item.account &&
      "login" in item.account &&
      item.account.login.toLowerCase() === fork.owner.toLowerCase(),
  );

  if (!installation || installation.permissions?.contents !== "write") {
    return { accessible: false };
  }

  const repositories = await octokit.paginate(
    octokit.apps.listInstallationReposForAuthenticatedUser,
    { installation_id: installation.id, per_page: 100 },
  );

  return {
    accessible: repositories.some(
      (repository) => repository.full_name.toLowerCase() === fork.fullName.toLowerCase(),
    ),
  };
});
