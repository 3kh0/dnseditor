import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  console.log("Received request body:", body);

  // Validate request body
  if (!body.domain || !body.record) {
    console.error("Invalid request body:", body);
    throw createError({
      statusCode: 400,
      message: "missing required fields",
    });
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  try {
    console.log(`Fetching current content for ${body.domain}`);
    const { data: fileData } = await octokit.repos.getContent({
      owner: "3kh0",
      repo: "dns",
      path: body.domain,
      ref: "main",
    });

    // Decode current content and keep original
    const currentContent = Buffer.from(fileData.content, "base64").toString();

    // Parse YAML to find insertion point
    const dnsRecords = yaml.load(currentContent) || {};
    const entries = Object.keys(dnsRecords);

    // Find where to insert the new record
    const subdomain = body.record.subdomain;
    let insertIndex = currentContent.length; // Default to end of file

    // Find position to insert new record while preserving format
    const lines = currentContent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip empty lines and comments
      if (!line || line.startsWith("#")) continue;

      // Look for domain definitions
      const match = line.match(/^['"]?([^'":]*)['"]?\s*:/);
      if (match && match[1] > subdomain) {
        // Found insertion point
        insertIndex = lines.slice(0, i).join("\n").length;
        break;
      }
    }

    // Format new record entry preserving style
    const recordYaml = yaml
      .dump({
        [subdomain]: {
          type: body.record.type,
          ttl: body.record.ttl,
          value: body.record.value,
        },
      })
      .trim();

    // Insert new record at the right position
    const updatedContent =
      currentContent.slice(0, insertIndex) +
      (insertIndex > 0 ? "\n" : "") +
      recordYaml +
      (insertIndex < currentContent.length ? "\n" : "") +
      currentContent.slice(insertIndex);

    console.log("Updated content:", updatedContent);

    // Create new branch and update
    const branchName = `dns-update-${Date.now()}`;
    console.log(`Creating new branch: ${branchName}`);

    const { data: ref } = await octokit.git.getRef({
      owner: "3kh0",
      repo: "dns",
      ref: "heads/main",
    });

    await octokit.git.createRef({
      owner: "3kh0",
      repo: "dns",
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });

    // Update file in new branch
    await octokit.repos.createOrUpdateFileContents({
      owner: "3kh0",
      repo: "dns",
      path: body.domain,
      message: `Add DNS record: ${body.record.subdomain}.${body.domain}`,
      content: Buffer.from(updatedContent).toString("base64"),
      branch: branchName,
      sha: fileData.sha,
    });

    // Create pull request
    const { data: pr } = await octokit.pulls.create({
      owner: "3kh0",
      repo: "dns",
      title: `Add record for ${body.record.subdomain}.${body.domain.slice(
        0,
        -5
      )}`,
      head: branchName,
      base: "main",
      body: `
Changes requested through DNS Editor

✨ New DNS Record:
\`\`\`yaml
${body.record.subdomain}:
  type: ${body.record.type}
  ttl: ${body.record.ttl}
  value: ${body.record.value}
\`\`\`

Please review these changes carefully.
`,
    });

    console.log("Pull request created:", pr.html_url);
    return {
      success: true,
      prUrl: pr.html_url,
    };
  } catch (error) {
    console.error("GitHub API error:", error);
    throw createError({
      statusCode: 500,
      message: `Failed to create pull request: ${error.message}`,
    });
  }
});
