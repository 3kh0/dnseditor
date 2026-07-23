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
  removeExistingRecord,
  replaceExistingRecord,
} from "../utils/dns-edit";
import {
  createBranchOnFork,
  createUserOctokit,
  formatCommitMessageWithBotCoAuthor,
  getAppBotIdentity,
  getInstallUrl,
  getUpstreamRepo,
  githubErrorMessage,
  isIntegrationAccessError,
  requireUserFork,
  requireUserSession,
  syncForkWithUpstream,
} from "../utils/github";

interface RecordInput {
  subdomain?: string;
  ttl?: number;
  type?: string;
  value?: unknown;
  mxPreference?: number;
  proxied?: boolean;
}

interface SubmitBody {
  domain?: string;
  action?: "add" | "edit" | "delete";
  contact?: string;
  records?: RecordInput[];
  record?: RecordInput & { contact?: string };
  original?: {
    type?: string;
    value?: unknown;
    mxPreference?: number;
  };
}

interface DeleteTarget {
  subdomain: string;
  type: string;
  value: string;
  mxPreference?: number;
}

interface NormalizedRecord {
  subdomain: string;
  type: string;
  ttl?: number;
  mxPreference: number;
  proxied: boolean;
  value: string;
  lines: string[];
}

const TYPES = new Set(["A", "AAAA", "CNAME", "ALIAS", "TXT", "MX"]);
const MAX_BATCH_RECORDS = 10;

function validateRecordInput(domain: string, input: RecordInput, label: string): NormalizedRecord {
  const at = label ? `${label}: ` : "";
  const subdomain = input.subdomain?.trim().toLowerCase();
  const type = input.type?.trim().toUpperCase();
  const rawValue = input.value;
  const mxPreference = Number(input.mxPreference ?? 10);
  const wantProxy = input.proxied === true;
  const ttl = parseOptionalTtl(input.ttl);

  if (!subdomain || !type || rawValue === undefined || rawValue === null || rawValue === "") {
    throw createError({ statusCode: 400, message: `${at}Missing required fields` });
  }
  if (!isSubdomain(subdomain)) {
    throw createError({
      statusCode: 400,
      message: `${at}Invalid subdomain. Use letters, numbers, hyphens, underscores, and dots.`,
    });
  }
  if (!TYPES.has(type)) {
    throw createError({ statusCode: 400, message: `${at}Unsupported record type: ${type}` });
  }

  const proxied = wantProxy && supportsCfProxy(domain, type);
  if (wantProxy && !proxied) {
    throw createError({
      statusCode: 400,
      message: `${at}Cloudflare proxy is only available on hackclub.com for A, AAAA, and CNAME records`,
    });
  }

  const value = normalizeRecordValue(type, rawValue, mxPreference);
  const lines = formatRecordLines({
    type,
    ttl: proxied ? undefined : ttl,
    value,
    mxPreference,
    proxied,
  });

  return { subdomain, type, ttl, mxPreference, proxied, value, lines };
}

function validateDeleteTarget(input: RecordInput | undefined): DeleteTarget {
  const subdomain = input?.subdomain?.trim().toLowerCase();
  const type = input?.type?.trim().toUpperCase();
  const rawValue = input?.value;

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

  const mxPreference = input?.mxPreference !== undefined ? Number(input.mxPreference) : undefined;
  const value = normalizeRecordValue(type, rawValue, mxPreference ?? (type === "MX" ? 10 : 0));

  return { subdomain, type, value, mxPreference };
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SubmitBody>(event);
  const session = await requireUserSession(event);
  const upstream = getUpstreamRepo(event);

  const action = body.action === "edit" ? "edit" : body.action === "delete" ? "delete" : "add";
  const domain = body.domain?.trim();
  const contact = (body.contact ?? body.record?.contact)?.trim();

  if (!domain || !isDomainFile(domain)) {
    throw createError({ statusCode: 400, message: "Unknown or missing domain file" });
  }
  if (action !== "delete" && (!contact || !hasContact(contact))) {
    throw createError({
      statusCode: 400,
      message: "Contact must include an email and/or Slack member ID (e.g. U012AB345CD)",
    });
  }

  if (action !== "add" && body.records) {
    throw createError({ statusCode: 400, message: "Batch records are only supported when adding" });
  }

  const deleteTarget = action === "delete" ? validateDeleteTarget(body.record) : null;

  const inputs =
    action === "add" && Array.isArray(body.records)
      ? body.records
      : action !== "delete" && body.record
        ? [body.record]
        : [];
  if (action !== "delete" && inputs.length === 0) {
    throw createError({ statusCode: 400, message: "Missing required fields" });
  }
  if (inputs.length > MAX_BATCH_RECORDS) {
    throw createError({
      statusCode: 400,
      message: `Too many records — at most ${MAX_BATCH_RECORDS} per pull request`,
    });
  }

  const recs = inputs.map((input, i) =>
    validateRecordInput(domain, input, inputs.length > 1 ? `Record ${i + 1}` : ""),
  );
  const first = recs[0];

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

  const octokit = createUserOctokit(session.accessToken);

  try {
    const fork = await requireUserFork(octokit, session.login, upstream.owner, upstream.repo);
    console.log(
      `[submit] ${session.login} ${action} ${domain} → fork ${fork.fullName} → PR ${upstream.owner}/${upstream.repo}`,
    );
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
    const newSubdomains = new Set<string>();

    if (action === "delete") {
      const target = deleteTarget!;
      if (!Object.prototype.hasOwnProperty.call(parsed, target.subdomain)) {
        throw createError({
          statusCode: 404,
          message: `Subdomain "${target.subdomain}" not found in ${domain}`,
        });
      }
      updated = removeExistingRecord(content, target.subdomain, {
        type: target.type,
        value: target.value,
        ...(target.type === "MX" && target.mxPreference !== undefined
          ? { mxPreference: target.mxPreference }
          : {}),
      });
    } else if (action === "edit") {
      if (!Object.prototype.hasOwnProperty.call(parsed, first!.subdomain)) {
        throw createError({
          statusCode: 404,
          message: `Subdomain "${first!.subdomain}" not found in ${domain}`,
        });
      }
      const matchValue = normalizeRecordValue(
        origType!,
        origValue,
        origMxPreference ?? (origType === "MX" ? 10 : 0),
      );
      updated = replaceExistingRecord(
        content,
        first!.subdomain,
        {
          type: origType!,
          value: matchValue,
          ...(origType === "MX" && origMxPreference !== undefined
            ? { mxPreference: origMxPreference }
            : {}),
        },
        contact!,
        {
          type: first!.type,
          ttl: first!.proxied ? undefined : first!.ttl,
          value: first!.value,
          mxPreference: first!.mxPreference,
          proxied: first!.proxied,
        },
      );
    } else {
      updated = content;
      for (const rec of recs) {
        const current = YAML.parse(updated);
        if (!isObj(current)) throw new Error(`${domain} does not contain a YAML mapping`);
        if (!Object.prototype.hasOwnProperty.call(current, rec.subdomain)) {
          newSubdomains.add(rec.subdomain);
          updated = insertNewSubdomain(
            updated,
            Object.keys(current),
            rec.subdomain,
            contact!,
            rec.lines,
          );
        } else {
          updated = appendToExistingSubdomain(updated, rec.subdomain, rec.lines);
        }
      }
    }

    const branchSubdomain = action === "delete" ? deleteTarget!.subdomain : first!.subdomain;
    const branch = `dns-editor-${branchSubdomain.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}-${Date.now()}`;
    const fqdns =
      action === "delete"
        ? [`${deleteTarget!.subdomain}.${bareDomain(domain)}`]
        : [...new Set(recs.map((rec) => `${rec.subdomain}.${bareDomain(domain)}`))];
    const fqdn = fqdns[0]!;
    const fqdnSummary =
      fqdns.length <= 3
        ? fqdns.join(", ")
        : `${fqdns.slice(0, 3).join(", ")} +${fqdns.length - 3} more`;
    const verb = action === "edit" ? "Update" : action === "delete" ? "Delete" : "Add";

    await syncForkWithUpstream(octokit, fork, fork.defaultBranch || upstream.branch);
    const { data: ref } = await octokit.git.getRef({
      owner: upstream.owner,
      repo: upstream.repo,
      ref: `heads/${upstream.branch}`,
    });
    await createBranchOnFork(octokit, fork, branch, ref.object.sha, upstream.branch);

    const bot = await getAppBotIdentity(octokit, event);
    const commitMessage = formatCommitMessageWithBotCoAuthor(
      recs.length > 1
        ? `Add ${recs.length} DNS records: ${fqdnSummary}`
        : `${verb} DNS record: ${fqdn}`,
      bot,
      action === "delete"
        ? "Removed with Hack Club DNS Editor."
        : "Submitted with Hack Club DNS Editor.",
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

    const previewGroups = new Map<string, string[]>();
    for (const rec of recs) {
      const lines = previewGroups.get(rec.subdomain) ?? [];
      lines.push(...rec.lines);
      previewGroups.set(rec.subdomain, lines);
    }
    const preview = [...previewGroups]
      .map(([sub, lines]) => [`${formatYamlKey(sub)}: # ${contact}`, ...lines].join("\n"))
      .join("\n");
    const prTitle =
      action === "delete"
        ? `Delete record for ${fqdn}`
        : recs.length > 1
          ? `Add ${recs.length} records: ${fqdnSummary}`
          : `${verb} record for ${fqdn}`;
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
        : action === "delete"
          ? `${deleteTarget!.type} ${deleteTarget!.value}${
              deleteTarget!.type === "MX" && deleteTarget!.mxPreference !== undefined
                ? ` (preference ${deleteTarget!.mxPreference})`
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
        : action === "delete"
          ? `## DNS Editor submission

Opened by @${session.login} via ${appLink}.

### Delete
Removing \`${originalPreview}\` under \`${fqdn}\`.

Please review carefully before merging.
`
          : `## DNS Editor submission

Opened by @${session.login} via ${appLink}.

### ${recs.length > 1 ? `New records (${recs.length})` : "New record"}
\`\`\`yaml
${preview}
\`\`\`

${newSubdomains.size > 0 ? `Contact: \`${contact}\`` : "Added to an existing subdomain entry."}

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

      console.log(
        `[submit] PR opened for ${session.login}: ${pr.html_url} (branch ${branch}, viaApp=${viaApp ?? "none"})`,
      );
      return { ...basePayload, prUrl: pr.html_url, needsManualPr: false, viaApp };
    } catch (prError) {
      console.warn(
        `[submit] pulls.create failed for ${session.login} (fork ${fork.fullName}, branch ${branch}), returning compare URL: ${githubErrorMessage(prError)}`,
      );
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
    if (isIntegrationAccessError(error)) {
      console.warn(
        `[submit] APP_INSTALL_REQUIRED for ${session.login} on ${domain}: app lacks contents:write on the fork (${githubErrorMessage(error)})`,
      );
      throw createError({
        statusCode: 403,
        message:
          "Install the GitHub App on your account and grant it access to your fork, then try again.",
        data: {
          code: "APP_INSTALL_REQUIRED",
          installUrl: getInstallUrl(event),
        },
      });
    }
    console.error(
      `[submit] GitHub API error for ${session.login} on ${action} ${domain}:`,
      githubErrorMessage(error),
      error,
    );
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
