import {
  createUserOctokit,
  findUserFork,
  getGitHubAppConfig,
  getInstallationManageUrl,
  getInstallUrl,
  getUpstreamRepo,
  requireUserSession,
} from "@/lib/server/github";
import { route } from "@/lib/server/http";

interface AppAccess {
  accessible: boolean;
  installed: boolean;
  manageUrl: string | null;
  missingPermissions: string[];
}

export const GET = route(async (ctx): Promise<AppAccess> => {
  ctx.headers.set("Cache-Control", "private, no-store");
  const session = await requireUserSession(ctx);
  const upstream = getUpstreamRepo();
  const appSlug = getGitHubAppConfig().appSlug;
  const installUrl = getInstallUrl();
  const octokit = createUserOctokit(session.accessToken);
  const fork = await findUserFork(octokit, session.login, upstream.owner, upstream.repo);

  if (!fork || !appSlug) {
    console.log(
      `[app-access] ${session.login}: ${!fork ? "no fork found" : "app slug not configured"}`,
    );
    return { accessible: false, installed: false, manageUrl: installUrl, missingPermissions: [] };
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
    return { accessible: false, installed: false, manageUrl: installUrl, missingPermissions: [] };
  }

  const manageUrl = getInstallationManageUrl(installation.id);
  const missingPermissions = [
    ...(installation.permissions?.contents === "write" ? [] : ["contents"]),
    ...(installation.permissions?.workflows === "write" ? [] : ["workflows"]),
  ];

  if (missingPermissions.length) {
    console.log(
      `[app-access] ${session.login}: installation ${installation.id} lacks write access to ${missingPermissions.join(", ")}`,
    );
    return { accessible: false, installed: true, manageUrl, missingPermissions };
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

  return { accessible, installed: true, manageUrl, missingPermissions: [] };
});
