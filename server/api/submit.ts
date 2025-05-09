import { Octokit } from "@octokit/rest";
import YAML from "yaml";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  // vibe check the request
  if (!body.domain || !body.record) {
    console.error("invalid request", body);
    throw createError({
      statusCode: 400,
      message: "missing required fields",
    });
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  try {
    const subdomain = body.record.subdomain;

    const { data: fileData } = await octokit.repos.getContent({
      owner: "3kh0",
      // we would change "3kh0" to "hackclub" in the future
      // LMAO THAT FUTURE NEVER CAME XDDDDDDDDDD
      repo: "dns",
      path: body.domain,
      ref: "main",
    });
    const currCon = Buffer.from(fileData.content, "base64").toString();

    // please be fucking normal
    const doc = YAML.parseDocument(currCon);

    // in or up
    if (!doc.has(subdomain)) {
      doc.set(subdomain, {
        type: body.record.type,
        ttl: body.record.ttl,
        value: body.record.value,
      });
    } else {
      const existing = doc.get(subdomain);
      if (Array.isArray(existing)) {
        existing.push({
          type: body.record.type,
          ttl: body.record.ttl,
          value: body.record.value,
        });
      } else {
        doc.set(subdomain, [
          existing,
          {
            type: body.record.type,
            ttl: body.record.ttl,
            value: body.record.value,
          },
        ]);
      }
    }

    // send back
    const updated = doc.toString();
    const branch = `dns-update-${Date.now()}`;

    const { data: ref } = await octokit.git.getRef({
      owner: "3kh0",
      repo: "dns",
      ref: "heads/main",
    });

    await octokit.git.createRef({
      owner: "3kh0",
      repo: "dns",
      ref: `refs/heads/${branch}`,
      sha: ref.object.sha,
    });

    // commit changes
    await octokit.repos.createOrUpdateFileContents({
      owner: "3kh0",
      repo: "dns",
      path: body.domain,
      message: `Add DNS record: ${body.record.subdomain}.${body.domain}`,
      content: Buffer.from(updated).toString("base64"),
      branch: branch,
      sha: fileData.sha,
    });

    // pull that thang
    const { data: pr } = await octokit.pulls.create({
      owner: "3kh0",
      repo: "dns",
      title: `Add record for ${body.record.subdomain}.${body.domain.slice(
        0,
        -5
      )}`,
      head: branch,
      base: "main",
      body: `
Changes requested through DNS Editor

✨ New DNS Record:
\`\`\`yaml
${YAML.stringify({ [subdomain]: doc.get(subdomain) }, { lineWidth: -1 }).trim()}
\`\`\`

Please review these changes carefully before merging :D
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
