import type { Summary } from "@/lib/deepseek";
import type { ImageCandidate } from "@/lib/ingest/youtube";
import { downloadImage } from "./fetch";
import { downloadAndStoreImages, type StoredImage } from "./store";

// High cap to honor "preserve all images on the page" intent for
// book-from-URL ingest. Acts as a safety net for pathological pages
// (galleries, infinite scrollers) rather than a routine filter.
const BOOK_IMAGE_CAP = 100;

// Generous safety net — we'd rather over-include for a personal vault
// than miss a useful figure. Bounds memory + GitHub commit size on
// pathological gallery pages.
const ARTICLE_IMAGE_CAP = 15;

// URL patterns that identify chrome/UI imagery rather than body content.
// Bracketed by a path separator or punctuation so we don't reject every
// URL that incidentally contains the substring "icon" (e.g. "iconography
// of the renaissance"). Keep additions conservative — a false positive
// drops a useful figure permanently.
const NON_CONTENT_URL = /\/(?:icons?|avatars?|profiles?|headshots?|logos?|badges?|flags?|emojis?|sprites?|spacers?|pixels?|buttons?|share)(?:\/|[-._])/i;

// 1x1 trackers, transparent pixels, and explicit "blank" images.
const TRACKING_PIXEL = /(?:^|\/)(?:1x1|blank|transparent|pixel)\.(?:gif|png|svg|webp)(?:$|\?)/i;

// Alt text that's clearly a placeholder rather than a description of
// the image's content.
const GENERIC_ALT = /^(?:image|photo|img|figure|picture|untitled|placeholder)(?:[\s_-]*\d*)?$/i;

function isContentImage(c: Pick<ImageCandidate, "url" | "alt">): boolean {
  const url = c.url ?? "";
  if (!url) return false;
  if (url.startsWith("data:")) return false;
  if (NON_CONTENT_URL.test(url)) return false;
  if (TRACKING_PIXEL.test(url)) return false;
  const alt = (c.alt ?? "").trim();
  if (alt && GENERIC_ALT.test(alt)) return false;
  return true;
}

export async function processArticleImages(input: {
  candidates: ImageCandidate[];
  summary: Summary;
  date: Date;
}): Promise<StoredImage[]> {
  const { candidates, date } = input;
  if (candidates.length === 0) return [];

  // Dedupe across hero + body. Readability sometimes surfaces the og:image
  // as both the hero and the first body image.
  const seen = new Set<string>();
  const ordered: { url: string; alt: string }[] = [];
  let bodyKept = 0;
  let bodyTotal = 0;

  const hero = candidates.find((c) => c.isHero);
  if (hero && !seen.has(hero.url)) {
    seen.add(hero.url);
    ordered.push({ url: hero.url, alt: hero.alt });
  }

  for (const c of candidates) {
    if (c.isHero) continue;
    bodyTotal++;
    if (seen.has(c.url)) continue;
    if (!isContentImage(c)) continue;
    seen.add(c.url);
    ordered.push({ url: c.url, alt: c.alt });
    bodyKept++;
    if (ordered.length >= ARTICLE_IMAGE_CAP) break;
  }

  if (ordered.length === 0) return [];

  const stored = await downloadAndStoreImages(ordered, date, downloadImage);
  console.log(
    `[images] article: stored ${stored.length}/${ordered.length} ` +
      `(hero=${hero ? "yes" : "no"}, body kept ${bodyKept}/${bodyTotal})`
  );
  return stored;
}

export async function processBookImages(input: {
  candidates: ImageCandidate[];
  date: Date;
}): Promise<StoredImage[]> {
  const { candidates, date } = input;
  if (candidates.length === 0) return [];

  const ordered = candidates.slice(0, BOOK_IMAGE_CAP).map((c) => ({
    url: c.url,
    alt: c.alt,
  }));
  const stored = await downloadAndStoreImages(ordered, date, downloadImage);
  console.log(
    `[images] book: stored ${stored.length}/${ordered.length} candidates`
  );
  return stored;
}
