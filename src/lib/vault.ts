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
 *
 * If `options.expectedSha` is provided, GitHub will reject the write when
 * the current file SHA differs (atomic compare-and-swap via the API's
 * `sha` parameter — no TOCTOU). The function returns `null` in that case
 * so the caller can decide whether to retry or back off. Used by the
 * deferred-enrichment path in /api/ingest to avoid clobbering a
 * concurrent edit during the enrichment window.
 */
export async function commitNote(
  filename: string,
  body: string,
  message?: string,
  options?: { expectedSha?: string }
): Promise<{ url: string; sha: string } | null> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  let existingSha: string | undefined = options?.expectedSha;
  if (!existingSha) {
    // Look up an existing file's SHA so we can update instead of conflict.
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
  }

  try {
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
  } catch (err) {
    // GitHub returns 409 (or sometimes 422) when the supplied `sha` no
    // longer matches the file's current SHA — i.e. the file was edited
    // between when the caller observed `expectedSha` and now. Surface
    // that as `null` so callers with a precondition can skip the write.
    const status = (err as { status?: number })?.status;
    if (
      options?.expectedSha &&
      (status === 409 || status === 422)
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Remove a markdown note from the vault. Returns true if the file was
 * deleted (or already absent), false if deletion failed. Callers should
 * treat failures as non-fatal — the DB is still the source of truth for
 * what's "live" in the UI.
 */
export async function deleteNote(
  filename: string,
  message?: string
): Promise<boolean> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  let sha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner,
      repo,
      path: filename,
    });
    if (!Array.isArray(existing.data) && "sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch (err) {
    if (isNotFound(err)) return true;
    return false;
  }
  if (!sha) return false;

  try {
    await octokit.repos.deleteFile({
      owner,
      repo,
      path: filename,
      message: message ?? `remove ${filename}`,
      sha,
    });
    return true;
  } catch (err) {
    if (isNotFound(err)) return true;
    return false;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 404
  );
}
