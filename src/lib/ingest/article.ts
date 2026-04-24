import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { IngestError } from "./errors";
import type { BodyLink, ImageCandidate, Normalized } from "./youtube";

const BODY_LINK_CAP = 12;
const IMAGE_CANDIDATE_CAP = 25;

export async function handleArticle(url: string): Promise<Normalized> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MyceliumBot/0.1; +https://github.com/wesheng19/mycelium)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new IngestError(
        `Timed out fetching that URL after 15 seconds. The site may be slow or unreachable.`
      );
    }
    throw new IngestError(
      `Couldn't reach that URL: ${err instanceof Error ? err.message : "network error"}. ` +
        "Check the link or paste the article text directly."
    );
  }

  if (!res.ok) {
    throw new IngestError(
      `That URL returned HTTP ${res.status} (${res.statusText}). ` +
        "It may be paywalled, require login, or block bots."
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("xml")) {
    throw new IngestError(
      `That URL returned content-type "${contentType}" instead of HTML. ` +
        "Mycelium can only extract articles from HTML pages."
    );
  }

  let html: string;
  try {
    html = await res.text();
  } catch {
    throw new IngestError("Failed to read the response body from that URL.");
  }

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    throw new IngestError(
      "Couldn't parse the HTML from that URL. The page may be malformed."
    );
  }

  const reader = new Readability(dom.window.document);
  const parsed = reader.parse();

  if (!parsed || !parsed.textContent?.trim()) {
    throw new IngestError(
      "Couldn't extract article content from that page. " +
        "It may be behind a paywall, heavily JS-rendered, or not a standard article. " +
        "Try pasting the text directly."
    );
  }

  const content = parsed.textContent.replace(/\s+\n/g, "\n").trim();
  const bodyLinks = parsed.content
    ? extractBodyLinks(parsed.content, url)
    : [];
  const heroImage = extractHeroImage(dom.window.document, url);
  const bodyImages = parsed.content
    ? extractBodyImages(parsed.content, url)
    : [];
  const imageCandidates = mergeImageCandidates(heroImage, bodyImages);
  const allPageImages = extractAllPageImages(dom.window.document, url);

  return {
    title: parsed.title ?? undefined,
    content,
    source: "article",
    url,
    bodyLinks,
    imageCandidates,
    allPageImages,
  };
}

function extractBodyLinks(htmlBody: string, baseUrl: string): BodyLink[] {
  let dom: JSDOM;
  try {
    dom = new JSDOM(htmlBody, { url: baseUrl });
  } catch {
    return [];
  }
  const basePathname = (() => {
    try {
      return new URL(baseUrl).pathname;
    } catch {
      return "";
    }
  })();
  const seen = new Set<string>();
  const out: BodyLink[] = [];
  for (const a of dom.window.document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") continue;
    if (absolute.hash && absolute.pathname === basePathname && !absolute.search) {
      continue;
    }
    const url = absolute.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const anchorText = (a.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (!anchorText) continue;
    out.push({ url, anchorText });
    if (out.length >= BODY_LINK_CAP) break;
  }
  return out;
}

function extractHeroImage(
  doc: Document,
  baseUrl: string
): ImageCandidate | null {
  const meta = (selector: string): string | null => {
    const el = doc.querySelector(selector);
    return el?.getAttribute("content")?.trim() || null;
  };
  const candidates = [
    meta('meta[property="og:image"]'),
    meta('meta[property="og:image:url"]'),
    meta('meta[name="twitter:image"]'),
    meta('meta[name="twitter:image:src"]'),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const abs = absolutize(c, baseUrl);
    if (!abs) continue;
    const alt =
      meta('meta[property="og:image:alt"]') ??
      meta('meta[name="twitter:image:alt"]') ??
      "";
    return { url: abs, alt, isHero: true };
  }
  return null;
}

function extractBodyImages(
  htmlBody: string,
  baseUrl: string
): ImageCandidate[] {
  let dom: JSDOM;
  try {
    dom = new JSDOM(htmlBody, { url: baseUrl });
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const img of dom.window.document.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!src) continue;
    if (src.startsWith("data:")) continue;
    const abs = absolutize(src, baseUrl);
    if (!abs) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const alt = (img.getAttribute("alt") ?? "").trim().slice(0, 300);
    out.push({ url: abs, alt });
    if (out.length >= IMAGE_CANDIDATE_CAP) break;
  }
  return out;
}

function mergeImageCandidates(
  hero: ImageCandidate | null,
  body: ImageCandidate[]
): ImageCandidate[] {
  if (!hero) return body;
  // If hero appears in body too, dedupe — keep the hero entry only.
  const filtered = body.filter((b) => b.url !== hero.url);
  return [hero, ...filtered];
}

/**
 * Every <img src> from the full document, in DOM order. No filtering by
 * Readability, parent element, size, or alt text — used by book-from-URL
 * ingest where the user wants every image on the page archived.
 */
function extractAllPageImages(doc: Document, baseUrl: string): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const img of doc.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:")) continue;
    const abs = absolutize(src, baseUrl);
    if (!abs) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const alt = (img.getAttribute("alt") ?? "").trim().slice(0, 300);
    out.push({ url: abs, alt });
  }
  return out;
}

function absolutize(href: string, baseUrl: string): string | null {
  try {
    const abs = new URL(href, baseUrl);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    return abs.toString();
  } catch {
    return null;
  }
}
