import { Octokit } from "@octokit/rest";

/**
 * Thin wrapper around Octokit for committing markdown files to the
 * vault repo (e.g. `wesheng19/mycelium-vault`).
 */
function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  return new Octokit({ auth: token });
}

function getRepo(): { owner: string; repo: string } {
  const full = process.env.VAULT_REPO ?? "";
  const [owner, repo] = full.split("/");
  if (!owner || !repo) {
    throw new Error(
      `VAULT_REPO must look like "owner/repo" (got "${full}")`
    );
  }
  return { owner, repo };
}

/**
 * Commit a markdown note to the vault repo on the default branch.
 * Stub: not yet wired into the ingest pipeline.
 */
export async function commitNote(
  filename: string,
  body: string,
  message?: string
): Promise<{ url: string; sha: string }> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  // Look up an existing file's SHA so we can update instead of conflict.
  let existingSha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner,
      repo,
      path: filename,
    });
    if (!Array.isArray(existing.data) && "sha" in existing.data) {
      existingSha = existing.data.sha;
    }
  } catch {
    // 404 — file doesn't exist yet, that's fine.
  }

  const result = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filename,
    message: message ?? `add ${filename}`,
    content: Buffer.from(body, "utf8").toString("base64"),
    sha: existingSha,
  });

  return {
    url: result.data.content?.html_url ?? "",
    sha: result.data.content?.sha ?? "",
  };
}
