import { Octokit } from "@octokit/rest";
import YAML from "yaml";
import { isDomainFile } from "#shared/dns";

interface SubmitBody {
  domain?: string;
  record?: {
    subdomain?: string;
    ttl?: number;
    type?: string;
    value?: unknown;
    contact?: string;
    mxPreference?: number;
  };
}

const RECORD_TYPES = new Set(["A", "AAAA", "CNAME", "ALIAS", "TXT", "MX"]);

export default defineEventHandler(async (event) => {
  const body = await readBody<SubmitBody>(event);
  const config = useRuntimeConfig(event);

  const domain = body.domain?.trim();
  const subdomain = body.record?.subdomain?.trim().toLowerCase();
  const type = body.record?.type?.trim().toUpperCase();
  const contact = body.record?.contact?.trim();
  const rawValue = body.record?.value;
  const mxPreference = Number(body.record?.mxPreference ?? 10);
  const ttl = parseOptionalTtl(body.record?.ttl);

  if (!domain || !isDomainFile(domain)) {
    throw createError({ statusCode: 400, message: "Unknown or missing domain file" });
  }

  if (!subdomain || !type || rawValue === undefined || rawValue === null || rawValue === "") {
    throw createError({ statusCode: 400, message: "Missing required fields" });
  }

  if (!/^[A-Za-z0-9_]([A-Za-z0-9._-]*[A-Za-z0-9_])?$/.test(subdomain)) {
    throw createError({
      statusCode: 400,
      message: "Invalid subdomain. Use letters, numbers, hyphens, underscores, and dots.",
    });
  }

  if (!RECORD_TYPES.has(type)) {
    throw createError({ statusCode: 400, message: `Unsupported record type: ${type}` });
  }

  if (!contact || !hasContactInfo(contact)) {
    throw createError({
      statusCode: 400,
      message: "Contact must include an email and/or Slack member ID (e.g. U012AB345CD)",
    });
  }

  const token =
    (typeof config.githubToken === "string" && config.githubToken) ||
    process.env.NUXT_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    "";
  if (!token) {
    throw createError({
      statusCode: 500,
      message: "Server is missing GITHUB_TOKEN / NUXT_GITHUB_TOKEN",
    });
  }

  const owner = String(
    config.dnsGithubOwner ||
      process.env.NUXT_DNS_GITHUB_OWNER ||
      process.env.DNS_GITHUB_OWNER ||
      "hackclub",
  );
  const repo = String(
    config.dnsGithubRepo ||
      process.env.NUXT_DNS_GITHUB_REPO ||
      process.env.DNS_GITHUB_REPO ||
      "dns",
  );
  const baseBranch = String(
    config.dnsGithubBranch ||
      process.env.NUXT_DNS_GITHUB_BRANCH ||
      process.env.DNS_GITHUB_BRANCH ||
      "main",
  );

  const recordValue = normalizeRecordValue(type, rawValue, mxPreference);
  const recordLines = formatRecordLines({ type, ttl, value: recordValue, mxPreference });

  const octokit = new Octokit({ auth: token });

  try {
    const { content: currentContent, sha: fileSha } = await readRepoFile(
      octokit,
      owner,
      repo,
      domain,
      baseBranch,
    );
    const parsed = YAML.parse(currentContent);

    if (!isPlainObject(parsed)) {
      throw new Error(`${domain} does not contain a YAML mapping`);
    }

    const existingKeys = Object.keys(parsed);
    const isNewSubdomain = !Object.prototype.hasOwnProperty.call(parsed, subdomain);

    const updated = isNewSubdomain
      ? insertNewSubdomain(currentContent, existingKeys, subdomain, contact, recordLines)
      : appendToExistingSubdomain(currentContent, subdomain, recordLines);

    const branch = `dns-editor-${subdomain.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}-${Date.now()}`;
    const domainName = domain.replace(/\.yaml$/, "");
    const fqdn = `${subdomain}.${domainName}`;

    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: ref.object.sha,
    });

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: domain,
      message: `Add DNS record: ${fqdn}`,
      content: Buffer.from(updated, "utf8").toString("base64"),
      branch,
      sha: fileSha,
    });

    const preview = [`${formatYamlKey(subdomain)}: # ${contact}`, ...recordLines].join("\n");

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: `Add record for ${fqdn}`,
      head: branch,
      base: baseBranch,
      body: `## DNS Editor submission

Submitted via [dnseditor](https://github.com/3kh0/dnseditor).

### New record
\`\`\`yaml
${preview}
\`\`\`

${isNewSubdomain ? `Contact: \`${contact}\`` : "Added to an existing subdomain entry."}

Please review carefully before merging.
`,
    });

    return {
      success: true,
      prUrl: pr.html_url,
      branch,
      owner,
      repo,
    };
  } catch (error) {
    console.error("GitHub API error:", error);
    throw createError({
      statusCode: 500,
      message: `Failed to create pull request: ${errorMessage(error)}`,
      data: { detail: errorMessage(error) },
    });
  }
});

/**
 * Read a text file from GitHub. Uses the Contents API when it returns body bytes,
 * otherwise falls back to the Git blob API (needed for larger files / sparse responses).
 */
async function readRepoFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
) {
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref });

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path} is not a file (got ${describeData(data)})`);
  }

  const file = data as {
    type?: string;
    sha?: string;
    content?: string;
    encoding?: string;
    size?: number;
  };

  if (file.type !== "file" || !file.sha) {
    throw new Error(`${path} is not a readable file (type=${file.type ?? "unknown"})`);
  }

  if (typeof file.content === "string" && file.content.length > 0) {
    const encoding = file.encoding === "base64" ? "base64" : "utf8";
    return {
      sha: file.sha,
      content: Buffer.from(file.content.replace(/\n/g, ""), encoding).toString("utf8"),
    };
  }

  const { data: blob } = await octokit.git.getBlob({
    owner,
    repo,
    file_sha: file.sha,
  });

  const encoding = blob.encoding === "base64" ? "base64" : "utf8";
  return {
    sha: file.sha,
    content: Buffer.from(blob.content.replace(/\n/g, ""), encoding).toString("utf8"),
  };
}

function describeData(data: unknown) {
  if (data === null) return "null";
  if (Array.isArray(data)) return "directory listing";
  return typeof data;
}

function hasContactInfo(value: string) {
  return /\b[UW][A-Z0-9]{8,12}\b/.test(value) || /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/.test(value);
}

function normalizeRecordValue(type: string, rawValue: unknown, mxPreference: number) {
  if (
    typeof rawValue !== "string" &&
    typeof rawValue !== "number" &&
    typeof rawValue !== "boolean"
  ) {
    throw createError({ statusCode: 400, message: "Record value must be a string" });
  }

  let value = String(rawValue).trim();
  if (!value) {
    throw createError({ statusCode: 400, message: "Record value cannot be empty" });
  }

  if (type === "MX" && (!Number.isFinite(mxPreference) || mxPreference < 0)) {
    throw createError({ statusCode: 400, message: "MX preference must be a non-negative number" });
  }

  if ((type === "CNAME" || type === "ALIAS" || type === "MX") && !value.endsWith(".")) {
    value = `${value}.`;
  }

  return value;
}

function parseOptionalTtl(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const ttl = Number(raw);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw createError({ statusCode: 400, message: "TTL must be a positive number when set" });
  }
  return ttl;
}

function formatRecordLines(input: {
  type: string;
  ttl?: number;
  value: string;
  mxPreference: number;
}) {
  const head =
    input.ttl !== undefined
      ? [`- ttl: ${input.ttl}`, `  type: ${input.type}`]
      : [`- type: ${input.type}`];

  if (input.type === "MX") {
    return [
      ...head,
      `  values:`,
      `  - exchange: ${input.value}`,
      `    preference: ${input.mxPreference}`,
    ];
  }

  const value =
    input.type === "TXT" && needsYamlQuotes(input.value)
      ? JSON.stringify(input.value)
      : input.value;

  return [...head, `  value: ${value}`];
}

function needsYamlQuotes(value: string) {
  return /[:#{}[\],&*!|>'"%@`]/.test(value) || value.includes(" ") || value === "";
}

function formatYamlKey(key: string) {
  if (key === "") return "''";
  if (/^\d/.test(key) || /[:#{}[\],&*!|>'"%@`\s]/.test(key)) {
    return `'${key.replace(/'/g, "''")}'`;
  }
  return key;
}

function insertNewSubdomain(
  content: string,
  existingKeys: string[],
  subdomain: string,
  contact: string,
  recordLines: string[],
) {
  const lines = splitLines(content);
  const topLevel = findTopLevelKeys(lines);
  const sortedKeys = [...existingKeys].sort(compareDnsKeys);
  const nextKey = sortedKeys.find((key) => compareDnsKeys(key, subdomain) > 0);

  const block = [`${formatYamlKey(subdomain)}: # ${contact}`, ...recordLines];

  if (!nextKey) {
    const trimmedEnd = [...lines];
    while (trimmedEnd.length && lastLine(trimmedEnd).trim() === "") {
      trimmedEnd.pop();
    }
    return joinLines([...trimmedEnd, ...block]);
  }

  const nextEntry = topLevel.find((entry) => entry.key === nextKey);
  if (!nextEntry) {
    throw new Error(`Could not locate insertion point before key "${nextKey}"`);
  }

  return joinLines([
    ...lines.slice(0, nextEntry.lineIndex),
    ...block,
    ...lines.slice(nextEntry.lineIndex),
  ]);
}

function appendToExistingSubdomain(content: string, subdomain: string, recordLines: string[]) {
  const lines = splitLines(content);
  const topLevel = findTopLevelKeys(lines);
  const entryIndex = topLevel.findIndex((entry) => entry.key === subdomain);

  if (entryIndex === -1) {
    throw new Error(`Subdomain "${subdomain}" not found in file for append`);
  }

  const entry = topLevel[entryIndex];
  if (!entry) {
    throw new Error(`Subdomain "${subdomain}" not found in file for append`);
  }

  const nextEntry = topLevel[entryIndex + 1];
  const endLine = nextEntry ? nextEntry.lineIndex : lines.length;

  let insertAt = endLine;
  while (insertAt > entry.lineIndex + 1 && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt -= 1;
  }

  return joinLines([...lines.slice(0, insertAt), ...recordLines, ...lines.slice(insertAt)]);
}

function lastLine(lines: string[]) {
  return lines[lines.length - 1] ?? "";
}

interface TopLevelKey {
  key: string;
  lineIndex: number;
}

function findTopLevelKeys(lines: string[]): TopLevelKey[] {
  const keys: TopLevelKey[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line[0] === " " || line[0] === "\t" || line.trimStart().startsWith("#")) {
      continue;
    }

    if (line.trimStart().startsWith("-")) continue;

    const match = line.match(/^('[^']*'|"[^"]*"|[^:#\s][^:#]*?)\s*:/);
    const rawKey = match?.[1];
    if (!rawKey) continue;

    keys.push({ key: unquoteYamlKey(rawKey.trim()), lineIndex: i });
  }

  return keys;
}

function unquoteYamlKey(raw: string) {
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function sortKey(key: string) {
  if (!key) return "";
  return key.split(".").reverse().join(".");
}

function compareDnsKeys(a: string, b: string) {
  return sortKey(a).localeCompare(sortKey(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function splitLines(content: string) {
  return content.split(/\r?\n/);
}

function joinLines(lines: string[]) {
  const body = lines.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return error instanceof Error ? error.message : "Unknown GitHub API error";
}
