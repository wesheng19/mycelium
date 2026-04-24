import { Octokit } from "@octokit/rest";
import { dateParts } from "@/lib/markdown";
import type { DownloadedImage } from "./fetch";

export type StoredImage = {
  hash: string;
  vaultPath: string;
  alt: string;
  sourceUrl: string;
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

export function imageVaultPath(date: Date, hash: string, ext: string): string {
  const { y, m } = dateParts(date);
  return `images/${y}/${m}/${hash}.${ext}`;
}

export async function commitImage(
  path: string,
  bytes: Uint8Array
): Promise<boolean> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  // Filename is content-hash, so an existing file already has the correct
  // bytes — nothing to do.
  try {
    await octokit.repos.getContent({ owner, repo, path });
    return true;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) {
      console.warn(`[images] existence check failed for ${path}:`, err);
      return false;
    }
    // 404 — fall through and create
  }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `add ${path}`,
      content: Buffer.from(bytes).toString("base64"),
    });
    return true;
  } catch (err) {
    // TOCTOU: a parallel ingest may have created the same content-hash file
    // between our existence check and this write. GitHub returns 409 (or 422
    // on some edge cases) when creating without a sha against an existing
    // file. Re-check existence — if it's there now, the bytes are ours by
    // construction (filename = content hash).
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 422) {
      try {
        await octokit.repos.getContent({ owner, repo, path });
        return true;
      } catch {
        // still missing — fall through to error path
      }
    }
    console.warn(`[images] commit failed for ${path}:`, err);
    return false;
  }
}

const COMMIT_CONCURRENCY = 3;

export async function downloadAndStoreImages(
  picks: { url: string; alt: string }[],
  date: Date,
  downloader: (url: string) => Promise<DownloadedImage | null>
): Promise<StoredImage[]> {
  // Phase 1: download all in parallel — these are external fetches, no
  // shared rate limit.
  const downloads = await Promise.all(
    picks.map(async (p) => ({ pick: p, dl: await downloader(p.url) }))
  );
  // Phase 2: commit with bounded concurrency to stay clear of GitHub
  // secondary rate limits when a book ingest pulls 20 images.
  const settled: (StoredImage | null)[] = new Array(picks.length).fill(null);
  for (let i = 0; i < downloads.length; i += COMMIT_CONCURRENCY) {
    const slice = downloads.slice(i, i + COMMIT_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ({ pick, dl }) => {
        if (!dl) return null;
        const path = imageVaultPath(date, dl.hash, dl.ext);
        const ok = await commitImage(path, dl.bytes);
        if (!ok) return null;
        return {
          hash: dl.hash,
          vaultPath: path,
          alt: pick.alt,
          sourceUrl: pick.url,
        } satisfies StoredImage;
      })
    );
    for (let j = 0; j < results.length; j++) {
      settled[i + j] = results[j];
    }
  }
  // Dedupe by hash — same image shared across picks gets one entry.
  // Order is preserved (settled is index-aligned with picks), so the
  // smallest-index occurrence wins.
  const seen = new Set<string>();
  const out: StoredImage[] = [];
  for (const s of settled) {
    if (!s || seen.has(s.hash)) continue;
    seen.add(s.hash);
    out.push(s);
  }
  return out;
}
