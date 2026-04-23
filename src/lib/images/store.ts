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
  } catch {
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
    console.warn(`[images] commit failed for ${path}:`, err);
    return false;
  }
}

export async function downloadAndStoreImages(
  picks: { url: string; alt: string }[],
  date: Date,
  downloader: (url: string) => Promise<DownloadedImage | null>
): Promise<StoredImage[]> {
  const settled = await Promise.all(
    picks.map(async (p) => {
      const dl = await downloader(p.url);
      if (!dl) return null;
      const path = imageVaultPath(date, dl.hash, dl.ext);
      const ok = await commitImage(path, dl.bytes);
      if (!ok) return null;
      return {
        hash: dl.hash,
        vaultPath: path,
        alt: p.alt,
        sourceUrl: p.url,
      } satisfies StoredImage;
    })
  );
  // Dedupe by hash — same image shared across picks gets one entry.
  const seen = new Set<string>();
  const out: StoredImage[] = [];
  for (const s of settled) {
    if (!s || seen.has(s.hash)) continue;
    seen.add(s.hash);
    out.push(s);
  }
  return out;
}
