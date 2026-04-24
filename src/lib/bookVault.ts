import { posix as path } from "node:path";
import { Octokit } from "@octokit/rest";
import type { Summary } from "./deepseek";
import { slugify, dateParts } from "./markdown";
import type { StoredImage } from "./images/store";
import { deleteNote } from "./vault";

export type BookEntryExtras = {
  url?: string;
  images?: StoredImage[];
};

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

export function bookPath(bookTitle: string): string {
  return `books/${slugify(bookTitle)}.md`;
}

function buildSection(
  entryId: string,
  summary: Summary,
  date: Date,
  bookFilePath: string,
  extras: BookEntryExtras
): string {
  const { iso } = dateParts(date);
  const lines: string[] = [
    `<!-- entry:${entryId} -->`,
    `## ${iso} — ${summary.title}`,
    "",
  ];
  if (extras.url) {
    lines.push(`Source: ${extras.url}`, "");
  }
  if (extras.images?.length) {
    const [hero, ...rest] = extras.images;
    lines.push(imageMarkdown(hero, bookFilePath), "");
    if (rest.length) {
      lines.push("### Figures", "");
      for (const img of rest) {
        lines.push(imageMarkdown(img, bookFilePath), "");
      }
    }
  }
  if (summary.tldr) {
    lines.push(`**TL;DR** ${summary.tldr}`, "");
  }
  if (summary.detailedSummary) {
    lines.push(summary.detailedSummary, "");
  }
  if (summary.takeaways.length) {
    lines.push("### Key takeaways");
    for (const t of summary.takeaways) lines.push(`- ${t}`);
    lines.push("");
  }
  if (summary.whyItMatters) {
    lines.push("### Why this matters", summary.whyItMatters, "");
  }
  if (summary.vocabulary.length) {
    lines.push("### Appendix — Vocabulary");
    for (const v of summary.vocabulary) {
      lines.push(`- **${v.word}** — ${v.explanation}`);
    }
    lines.push("");
  }
  if (summary.tags.length) {
    lines.push(summary.tags.map((t) => `#${t}`).join(" "), "");
  }
  lines.push(`<!-- /entry:${entryId} -->`);
  return lines.join("\n");
}

function imageMarkdown(image: StoredImage, fromPath: string): string {
  const rel = path.relative(path.dirname(fromPath), image.vaultPath) || image.vaultPath;
  const alt = image.alt.trim().replace(/[\[\]]/g, "");
  return `![${alt}](${rel})`;
}

function buildHeader(bookTitle: string, date: Date): string {
  const { iso } = dateParts(date);
  return [
    "---",
    `book: ${JSON.stringify(bookTitle)}`,
    `created: ${iso}`,
    `tags: ["book"]`,
    "---",
    "",
    `# ${bookTitle}`,
    "",
  ].join("\n");
}

/**
 * Append a new entry section to the book's markdown file, creating the
 * file with a header block if it doesn't exist yet. Returns the path.
 */
export async function appendBookSection(
  bookTitle: string,
  entryId: string,
  summary: Summary,
  date: Date,
  extras: BookEntryExtras = {}
): Promise<string> {
  const filePath = bookPath(bookTitle);
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  let existingSha: string | undefined;
  let existingBody = "";
  try {
    const existing = await octokit.repos.getContent({ owner, repo, path: filePath });
    if (!Array.isArray(existing.data) && "sha" in existing.data) {
      existingSha = existing.data.sha;
      if ("content" in existing.data && existing.data.content) {
        existingBody = Buffer.from(existing.data.content, "base64").toString(
          "utf8"
        );
      }
    }
  } catch {
    // file doesn't exist yet — we'll create it
  }

  const section = buildSection(entryId, summary, date, filePath, extras);
  const newBody = existingBody
    ? `${existingBody.replace(/\s+$/, "")}\n\n${section}\n`
    : `${buildHeader(bookTitle, date)}${section}\n`;

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: existingSha
      ? `append to ${filePath}`
      : `create ${filePath}`,
    content: Buffer.from(newBody, "utf8").toString("base64"),
    sha: existingSha,
  });

  return filePath;
}

/**
 * Remove a single entry's section (wrapped in entry markers) from the
 * book's file. If no sections remain after removal, the file is deleted
 * entirely. Returns true on success (or if the file was already gone).
 */
export async function removeBookSections(
  path: string,
  entryIds: string[]
): Promise<boolean> {
  if (entryIds.length === 0) return true;
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  let sha: string;
  let body: string;
  try {
    const existing = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(existing.data) || !("sha" in existing.data)) return false;
    sha = existing.data.sha;
    body =
      "content" in existing.data && existing.data.content
        ? Buffer.from(existing.data.content, "base64").toString("utf8")
        : "";
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err as { status: unknown }).status === 404
    ) {
      return true;
    }
    return false;
  }

  let next = body;
  for (const id of entryIds) {
    const pattern = new RegExp(
      `\\n*<!-- entry:${escapeRegex(id)} -->[\\s\\S]*?<!-- /entry:${escapeRegex(id)} -->\\n*`,
      "g"
    );
    next = next.replace(pattern, "\n\n");
  }
  next = next.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";

  // If no entry markers are left, the book file has no remaining entries —
  // remove it entirely.
  if (!/<!-- entry:[0-9a-f-]+ -->/.test(next)) {
    return deleteNote(path, `remove ${path}`);
  }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `remove ${entryIds.length} section(s) from ${path}`,
      content: Buffer.from(next, "utf8").toString("base64"),
      sha,
    });
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
