import { Octokit } from "@octokit/rest";
import YAML from "yaml";
import {
  bareDomain,
  hasContact,
  isDomainFile,
  isObj,
  isSubdomain,
  supportsCfProxy,
} from "#shared/dns";
import {
  appendToExistingSubdomain,
  formatRecordLines,
  formatYamlKey,
  insertNewSubdomain,
  normalizeRecordValue,
  parseOptionalTtl,
  replaceExistingRecord,
} from "../utils/dns-edit";
import {
  createBranchOnFork,
  createUserOctokit,
  formatCommitMessageWithBotCoAuthor,
  getAppBotIdentity,
  getUpstreamRepo,
  githubErrorMessage,
  requireUserFork,
  requireUserSession,
  syncForkWithUpstream,
} from "../utils/github";

interface SubmitBody {
  domain?: string;
  action?: "add" | "edit";
  record?: {
    subdomain?: string;
    ttl?: number;
    type?: string;
    value?: unknown;
    contact?: string;
    mxPreference?: number;
    proxied?: boolean;
  };
  original?: {
    type?: string;
    value?: unknown;
    mxPreference?: number;
  };
}

const TYPES = new Set(["A", "AAAA", "CNAME", "ALIAS", "TXT", "MX"]);

export default defineEventHandler(async (event) => {
  const body = await readBody<SubmitBody>(event);
  const session = await requireUserSession(event);
  const upstream = getUpstreamRepo(event);

  const action = body.action === "edit" ? "edit" : "add";
  const domain = body.domain?.trim();
  const subdomain = body.record?.subdomain?.trim().toLowerCase();
  const type = body.record?.type?.trim().toUpperCase();
  const contact = body.record?.contact?.trim();
  const rawValue = body.record?.value;
  const mxPreference = Number(body.record?.mxPreference ?? 10);
  const wantProxy = body.record?.proxied === true;
  const ttl = parseOptionalTtl(body.record?.ttl);

  if (!domain || !isDomainFile(domain)) {
    throw createError({ statusCode: 400, message: "Unknown or missing domain file" });
  }
  if (!subdomain || !type || rawValue === undefined || rawValue === null || rawValue === "") {
    throw createError({ statusCode: 400, message: "Missing required fields" });
  }
  if (!isSubdomain(subdomain)) {
    throw createError({
      statusCode: 400,
      message: "Invalid subdomain. Use letters, numbers, hyphens, underscores, and dots.",
    });
  }
  if (!TYPES.has(type)) {
    throw createError({ statusCode: 400, message: `Unsupported record type: ${type}` });
  }
  if (!contact || !hasContact(contact)) {
    throw createError({
      statusCode: 400,
      message: "Contact must include an email and/or Slack member ID (e.g. U012AB345CD)",
    });
  }

  const origType = body.original?.type?.trim().toUpperCase();
  const origValue = body.original?.value;
  const origMxPreference =
    body.original?.mxPreference !== undefined ? Number(body.original.mxPreference) : undefined;

  if (action === "edit") {
    if (!origType || origValue === undefined || origValue === null || origValue === "") {
      throw createError({
        statusCode: 400,
        message: "Edit requires original.type and original.value to identify the record",
      });
    }
    if (!TYPES.has(origType)) {
      throw createError({
        statusCode: 400,
        message: `Unsupported original record type: ${origType}`,
      });
    }
  }

  const proxied = wantProxy && supportsCfProxy(domain, type);
  if (wantProxy && !proxied) {
    throw createError({
      statusCode: 400,
      message: "Cloudflare proxy is only available on hackclub.com for A, AAAA, and CNAME records",
    });
  }

  const recordValue = normalizeRecordValue(type, rawValue, mxPreference);
  const recordLines = formatRecordLines({
    type,
    // Cloudflare auto-TTL when orange-clouded
    ttl: proxied ? undefined : ttl,
    value: recordValue,
    mxPreference,
    proxied,
  });
  const octokit = createUserOctokit(session.accessToken);

  try {
    const fork = await requireUserFork(octokit, session.login, upstream.owner, upstream.repo);
    const { content, sha } = await readRepoFile(
      octokit,
      upstream.owner,
      upstream.repo,
      domain,
      upstream.branch,
    );
    const parsed = YAML.parse(content);
    if (!isObj(parsed)) throw new Error(`${domain} does not contain a YAML mapping`);

    let updated: string;
    let isNew = false;

    if (action === "edit") {
      if (!Object.prototype.hasOwnProperty.call(parsed, subdomain)) {
        throw createError({
          statusCode: 404,
          message: `Subdomain "${subdomain}" not found in ${domain}`,
        });
      }
      const matchValue = normalizeRecordValue(
        origType!,
        origValue,
        origMxPreference ?? (origType === "MX" ? 10 : 0),
      );
      updated = replaceExistingRecord(
        content,
        subdomain,
        {
          type: origType!,
          value: matchValue,
          ...(origType === "MX" && origMxPreference !== undefined
            ? { mxPreference: origMxPreference }
            : {}),
        },
        contact,
        {
          type,
          ttl: proxied ? undefined : ttl,
          value: recordValue,
          mxPreference,
          proxied,
        },
      );
    } else {
      isNew = !Object.prototype.hasOwnProperty.call(parsed, subdomain);
      updated = isNew
        ? insertNewSubdomain(content, Object.keys(parsed), subdomain, contact, recordLines)
        : appendToExistingSubdomain(content, subdomain, recordLines);
    }

    const branch = `dns-editor-${subdomain.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}-${Date.now()}`;
    const fqdn = `${subdomain}.${bareDomain(domain)}`;
    const verb = action === "edit" ? "Update" : "Add";

    await syncForkWithUpstream(octokit, fork, fork.defaultBranch || upstream.branch);
    const { data: ref } = await octokit.git.getRef({
      owner: upstream.owner,
      repo: upstream.repo,
      ref: `heads/${upstream.branch}`,
    });
    await createBranchOnFork(octokit, fork, branch, ref.object.sha, upstream.branch);

    const bot = await getAppBotIdentity(octokit, event);
    const commitMessage = formatCommitMessageWithBotCoAuthor(
      `${verb} DNS record: ${fqdn}`,
      bot,
      "Submitted with Hack Club DNS Editor.",
    );

    await octokit.repos.createOrUpdateFileContents({
      owner: fork.owner,
      repo: fork.repo,
      path: domain,
      message: commitMessage,
      content: Buffer.from(updated, "utf8").toString("base64"),
      branch,
      sha,
    });

    const preview = [`${formatYamlKey(subdomain)}: # ${contact}`, ...recordLines].join("\n");
    const prTitle = `${verb} record for ${fqdn}`;
    const appLink = bot
      ? `[${bot.login}](${bot.htmlUrl})`
      : "[Hack Club DNS Editor](https://github.com/apps/hack-club-dns-editor)";

    const originalPreview =
      action === "edit"
        ? `${origType} ${String(origValue)}${
            origType === "MX" && origMxPreference !== undefined
              ? ` (preference ${origMxPreference})`
              : ""
          }`
        : "";

    const prBody =
      action === "edit"
        ? `## DNS Editor submission

Opened by @${session.login} via ${appLink}.

### Edit
Replacing existing \`${originalPreview}\` under \`${fqdn}\`.

### Updated record
\`\`\`yaml
${preview}
\`\`\`

Contact: \`${contact}\`

Please review carefully before merging.
`
        : `## DNS Editor submission

Opened by @${session.login} via ${appLink}.

### New record
\`\`\`yaml
${preview}
\`\`\`

${isNew ? `Contact: \`${contact}\`` : "Added to an existing subdomain entry."}

Please review carefully before merging.
`;

    const compareUrl =
      `https://github.com/${upstream.owner}/${upstream.repo}/compare/` +
      `${encodeURIComponent(upstream.branch)}...${encodeURIComponent(`${fork.owner}:${branch}`)}` +
      `?quick_pull=1&title=${encodeURIComponent(prTitle)}&body=${encodeURIComponent(prBody)}`;

    const forkPayload = { owner: fork.owner, repo: fork.repo, fullName: fork.fullName };
    const basePayload = {
      success: true as const,
      branch,
      fork: forkPayload,
      owner: upstream.owner,
      repo: upstream.repo,
    };

    try {
      const { data: pr } = await octokit.pulls.create({
        owner: upstream.owner,
        repo: upstream.repo,
        title: prTitle,
        head: `${fork.owner}:${branch}`,
        base: upstream.branch,
        maintainer_can_modify: true,
        body: prBody,
      });

      let viaApp: string | null = null;
      try {
        const { data: issue } = await octokit.issues.get({
          owner: upstream.owner,
          repo: upstream.repo,
          issue_number: pr.number,
        });
        viaApp = issue.performed_via_github_app?.name ?? null;
        if (!viaApp) {
          console.warn(
            "PR opened but performed_via_github_app is empty — token may not be a GitHub App user token",
          );
        }
      } catch {
        /* non-fatal */
      }

      return { ...basePayload, prUrl: pr.html_url, needsManualPr: false, viaApp };
    } catch (prError) {
      console.warn("pulls.create failed, returning compare URL:", githubErrorMessage(prError));
      return {
        ...basePayload,
        prUrl: compareUrl,
        needsManualPr: true,
        viaApp: null,
        message:
          "Pushed your branch to your fork, but the API could not open the PR " +
          "(so GitHub will not show the app badge). Open it in the browser to finish.",
      };
    }
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    console.error("GitHub API error:", error);
    throw createError({
      statusCode: 500,
      message: `Failed to create pull request: ${githubErrorMessage(error)}`,
      data: { detail: githubErrorMessage(error) },
    });
  }
});

async function readRepoFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
) {
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path} is not a file (got ${describe(data)})`);
  }

  const file = data as {
    type?: string;
    sha?: string;
    content?: string;
    encoding?: string;
  };

  if (file.type !== "file" || !file.sha) {
    throw new Error(`${path} is not a readable file (type=${file.type ?? "unknown"})`);
  }

  const decode = (content: string, encoding?: string) =>
    Buffer.from(content.replace(/\n/g, ""), encoding === "base64" ? "base64" : "utf8").toString(
      "utf8",
    );

  if (typeof file.content === "string" && file.content.length > 0) {
    return { sha: file.sha, content: decode(file.content, file.encoding) };
  }

  const { data: blob } = await octokit.git.getBlob({ owner, repo, file_sha: file.sha });
  return { sha: file.sha, content: decode(blob.content, blob.encoding) };
}

const describe = (data: unknown) =>
  data === null ? "null" : Array.isArray(data) ? "directory listing" : typeof data;
