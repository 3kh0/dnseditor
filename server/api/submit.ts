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

  // Initialize Octokit with GitHub token
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  try {
    console.log(`Fetching current content for ${body.domain}`);
    // Get the current file content
    const { data: fileData } = await octokit.repos.getContent({
      owner: "3kh0",
      repo: "dns",
      path: body.domain,
      ref: "main",
    });

    console.log("Current file data:", fileData);

    // Decode current content
    const currentContent = Buffer.from(fileData.content, "base64").toString();
    console.log("Current YAML content:", currentContent);

    // Parse current YAML
    const dnsRecords = yaml.load(currentContent) || {};
    console.log("Parsed DNS records:", dnsRecords);

    // Add new record
    if (!dnsRecords[body.record.subdomain]) {
      dnsRecords[body.record.subdomain] = [];
    }
    if (!Array.isArray(dnsRecords[body.record.subdomain])) {
      dnsRecords[body.record.subdomain] = [dnsRecords[body.record.subdomain]];
    }

    dnsRecords[body.record.subdomain].push({
      type: body.record.type,
      ttl: body.record.ttl,
      value: body.record.value,
    });

    // Convert back to YAML
    const updatedContent = yaml.dump(dnsRecords);
    console.log("Updated YAML content:", updatedContent);

    // Create a new branch
    const timestamp = Date.now();
    const branchName = `dns-update-${timestamp}`;
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

    console.log("Updating file contents");
    // Update file in new branch
    await octokit.repos.createOrUpdateFileContents({
      owner: "3kh0",
      repo: "dns",
      path: body.domain,
      message: `Update DNS record for ${body.domain}`,
      content: Buffer.from(updatedContent).toString("base64"),
      branch: branchName,
      sha: fileData.sha,
    });

    console.log("Creating pull request");
    // Create pull request
    const { data: pr } = await octokit.pulls.create({
      owner: "3kh0",
      repo: "dns",
      title: `DNS: Update records for ${body.domain}`,
      head: branchName,
      base: "main",
      body: `
Changes requested through DNS Editor

Domain: ${body.domain}
Record Type: ${body.record.type}
Subdomain: ${body.record.subdomain}
Value: ${body.record.value}
TTL: ${body.record.ttl}

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
