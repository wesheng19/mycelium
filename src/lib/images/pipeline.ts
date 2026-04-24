import type { Summary } from "@/lib/deepseek";
import type { ImageCandidate } from "@/lib/ingest/youtube";
import { pickArticleBodyImages } from "@/lib/agent/images";
import { downloadImage } from "./fetch";
import { downloadAndStoreImages, type StoredImage } from "./store";

// High cap to honor "preserve all images on the page" intent for
// book-from-URL ingest. Acts as a safety net for pathological pages
// (galleries, infinite scrollers) rather than a routine filter.
const BOOK_IMAGE_CAP = 100;

export async function processArticleImages(input: {
  candidates: ImageCandidate[];
  summary: Summary;
  date: Date;
}): Promise<StoredImage[]> {
  const { candidates, summary, date } = input;
  if (candidates.length === 0) return [];

  const hero = candidates.find((c) => c.isHero);
  const bodyPicks = await pickArticleBodyImages({ summary, candidates });

  const ordered = [
    ...(hero ? [{ url: hero.url, alt: hero.alt }] : []),
    ...bodyPicks.map((b) => ({ url: b.url, alt: b.alt })),
  ];
  if (ordered.length === 0) return [];

  const stored = await downloadAndStoreImages(ordered, date, downloadImage);
  console.log(
    `[images] article: stored ${stored.length}/${ordered.length} ` +
      `(hero=${hero ? "yes" : "no"}, body=${bodyPicks.length})`
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
