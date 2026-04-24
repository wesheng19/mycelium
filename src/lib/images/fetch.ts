import { createHash } from "node:crypto";

export type DownloadedImage = {
  hash: string;
  ext: string;
  contentType: string;
  bytes: Uint8Array;
};

const IMAGE_TIMEOUT_MS = 5_000;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

// SVG is intentionally omitted — it can embed scripts (and Obsidian / many
// markdown renderers display SVG inline). Only raster formats are stored.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

export async function downloadImage(url: string): Promise<DownloadedImage | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MyceliumBot/0.1; +https://github.com/wesheng19/mycelium)",
        Accept: "image/*,*/*;q=0.5",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/")) return null;
  const ext = EXT_BY_MIME[contentType];
  if (!ext) return null;

  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (declaredLength > IMAGE_MAX_BYTES) return null;

  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return { hash, ext, contentType, bytes };
}
