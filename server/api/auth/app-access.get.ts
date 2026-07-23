import {
  createUserOctokit,
  findUserFork,
  getGitHubAppConfig,
  getInstallationManageUrl,
  getInstallUrl,
  getUpstreamRepo,
  requireUserSession,
} from "../../utils/github";

interface AppAccess {
  accessible: boolean;
  installed: boolean;
  manageUrl: string | null;
}

export default defineEventHandler(async (event): Promise<AppAccess> => {
  const session = await requireUserSession(event);
  const upstream = getUpstreamRepo(event);
  const appSlug = getGitHubAppConfig(event).appSlug;
  const installUrl = getInstallUrl(event);
  const octokit = createUserOctokit(session.accessToken);
  const fork = await findUserFork(octokit, session.login, upstream.owner, upstream.repo);

  if (!fork || !appSlug) {
    console.log(
      `[app-access] ${session.login}: ${!fork ? "no fork found" : "app slug not configured"}`,
    );
    return { accessible: false, installed: false, manageUrl: installUrl };
  }

  const { data } = await octokit.apps.listInstallationsForAuthenticatedUser({ per_page: 100 });
  const installation = data.installations.find(
    (item) =>
      item.app_slug?.toLowerCase() === appSlug.toLowerCase() &&
      item.account &&
      "login" in item.account &&
      item.account.login.toLowerCase() === fork.owner.toLowerCase(),
  );

  if (!installation) {
    console.log(`[app-access] ${session.login}: app not installed on ${fork.owner}`);
    return { accessible: false, installed: false, manageUrl: installUrl };
  }

  const manageUrl = getInstallationManageUrl(installation.id);

  if (installation.permissions?.contents !== "write") {
    console.log(
      `[app-access] ${session.login}: installation ${installation.id} lacks contents:write (has "${installation.permissions?.contents ?? "none"}")`,
    );
    return { accessible: false, installed: true, manageUrl };
  }

  const repositories = await octokit.paginate(
    octokit.apps.listInstallationReposForAuthenticatedUser,
    { installation_id: installation.id, per_page: 100 },
  );

  const accessible = repositories.some(
    (repository) => repository.full_name.toLowerCase() === fork.fullName.toLowerCase(),
  );
  console.log(
    `[app-access] ${session.login}: installation ${installation.id}, ${accessible ? "covers" : "does NOT cover"} fork ${fork.fullName} (${repositories.length} repos granted)`,
  );

  return { accessible, installed: true, manageUrl };
});
