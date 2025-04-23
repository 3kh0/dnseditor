import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function lintYamlFiles() {
  try {
    // Get all YAML files from the repo
    const { data: files } = await octokit.repos.getContent({
      owner: "3kh0",
      repo: "dns",
      path: "",
    });

    const yamlFiles = files.filter(
      (file) => file.name.endsWith(".yaml") || file.name.endsWith(".yml")
    );

    console.log(`Found ${yamlFiles.length} YAML files to process`);

    // Create a new branch
    const branchName = `lint-yaml-files-${Date.now()}`;
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

    // Process each YAML file
    for (const file of yamlFiles) {
      console.log(`Processing ${file.name}...`);

      const { data: content } = await octokit.repos.getContent({
        owner: "3kh0",
        repo: "dns",
        path: file.name,
        ref: "main",
      });

      // Decode content
      const currentContent = Buffer.from(content.content, "base64").toString();

      try {
        // Parse and re-dump YAML with consistent formatting
        const parsed = yaml.load(currentContent);
        const formatted = yaml.dump(parsed, {
          lineWidth: -1, // Prevent line wrapping
          noRefs: true,
          quotingType: '"',
          forceQuotes: true,
        });

        // Update file if content changed
        if (currentContent !== formatted) {
          await octokit.repos.createOrUpdateFileContents({
            owner: "3kh0",
            repo: "dns",
            path: file.name,
            message: `🧹 Lint: Format ${file.name}`,
            content: Buffer.from(formatted).toString("base64"),
            branch: branchName,
            sha: content.sha,
          });
          console.log(`✅ Formatted ${file.name}`);
        } else {
          console.log(`⏭️  No changes needed for ${file.name}`);
        }
      } catch (err) {
        console.error(`❌ Error processing ${file.name}:`, err);
      }
    }

    // Create pull request
    const { data: pr } = await octokit.pulls.create({
      owner: "3kh0",
      repo: "dns",
      title: "linting",
      head: branchName,
      base: "main",
      body: `linting fixes`,
    });

    console.log(`✨ Pull request created: ${pr.html_url}`);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the script
