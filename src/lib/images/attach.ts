import { posix as path } from "node:path";
import { Octokit } from "@octokit/rest";
import type { StoredImage } from "./store";

function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return new Octokit({ auth: token });
}

function getRepo(): { owner: string; repo: string } {
  const full = process.env.VAULT_REPO ?? "";
  const [owner, repo] = full.split("/");
  if (!owner || !repo) {
    throw new Error(`VAULT_REPO must look like "owner/repo" (got "${full}")`);
  }
  return { owner, repo };
}

function imageMarkdown(image: StoredImage, fromPath: string): string {
  const rel =
    path.relative(path.dirname(fromPath), image.vaultPath) || image.vaultPath;
  const alt = image.alt.trim().replace(/[\[\]]/g, "");
  return `![${alt}](${rel})`;
}

/**
 * Inject image references into an existing standalone note. Adds (or
 * extends) an "## Attached" section at the end of the file.
 */
export async function attachToNote(
  notePath: string,
  images: StoredImage[]
): Promise<boolean> {
  if (images.length === 0) return true;
  const { body, sha } = await readVaultFile(notePath);
  if (sha === null) return false;

  const lines = images.map((img) => imageMarkdown(img, notePath));
  let next: string;
  if (/\n##\s+Attached\s*\n/i.test(body)) {
    // Append to existing Attached section — at the very end of the file
    // since Attached is intended to be the last section.
    next = `${body.replace(/\s+$/, "")}\n${lines.join("\n")}\n`;
  } else {
    next = `${body.replace(/\s+$/, "")}\n\n## Attached\n\n${lines.join("\n")}\n`;
  }

  return writeVaultFile(notePath, next, sha, `attach ${images.length} image(s) to ${notePath}`);
}

/**
 * Inject image references into a specific entry within a per-book file,
 * placed before the closing `<!-- /entry:UUID -->` marker under an
 * "### Attached" sub-heading.
 */
export async function attachToBookEntry(
  bookFilePath: string,
  entryId: string,
  images: StoredImage[]
): Promise<boolean> {
  if (images.length === 0) return true;
  const { body, sha } = await readVaultFile(bookFilePath);
  if (sha === null) return false;

  const close = `<!-- /entry:${entryId} -->`;
  const closeIdx = body.indexOf(close);
  if (closeIdx === -1) {
    console.warn(`[attach] entry marker not found for ${entryId} in ${bookFilePath}`);
    return false;
  }

  const before = body.slice(0, closeIdx).replace(/\s+$/, "");
  const after = body.slice(closeIdx);

  const imageLines = images.map((img) => imageMarkdown(img, bookFilePath));
  // Look for an existing Attached sub-heading within this entry's slice.
  // Walk back to the opening marker for this entry to bound the search.
  const open = `<!-- entry:${entryId} -->`;
  const openIdx = before.lastIndexOf(open);
  const sectionSlice = openIdx >= 0 ? before.slice(openIdx) : before;
  const hasAttached = /\n###\s+Attached\s*\n/i.test(sectionSlice);

  const insertion = hasAttached
    ? `\n${imageLines.join("\n")}\n`
    : `\n\n### Attached\n\n${imageLines.join("\n")}\n`;

  const next = `${before}${insertion}\n${after}`;
  return writeVaultFile(
    bookFilePath,
    next,
    sha,
    `attach ${images.length} image(s) to entry ${entryId}`
  );
}

async function readVaultFile(
  filePath: string
): Promise<{ body: string; sha: string | null }> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: filePath });
    if (Array.isArray(res.data) || !("sha" in res.data)) {
      return { body: "", sha: null };
    }
    const body =
      "content" in res.data && res.data.content
        ? Buffer.from(res.data.content, "base64").toString("utf8")
        : "";
    return { body, sha: res.data.sha };
  } catch (err) {
    console.warn(`[attach] failed to read ${filePath}:`, err);
    return { body: "", sha: null };
  }
}

async function writeVaultFile(
  filePath: string,
  body: string,
  sha: string,
  message: string
): Promise<boolean> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(body, "utf8").toString("base64"),
      sha,
    });
    return true;
  } catch (err) {
    console.warn(`[attach] write failed for ${filePath}:`, err);
    return false;
  }
}
