import { JSDOM } from "jsdom";
import { IngestError } from "./errors";
import { handleArticle } from "./article";
import type { Normalized } from "./youtube";

const APPLE_NEWS_HOSTS = new Set(["apple.news", "www.apple.news"]);

export function isAppleNewsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return APPLE_NEWS_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function isAppleNewsHost(href: string): boolean {
  try {
    return APPLE_NEWS_HOSTS.has(new URL(href).hostname);
  } catch {
    return false;
  }
}

/**
 * Apple News share links (apple.news/<id>) land on a splash page that
 * asks the user to open the article in the Apple News app. For content
 * syndicated from a web publisher (NYT, Ars Technica, etc.) the splash
 * HTML usually carries the publisher's URL in a canonical/og meta tag
 * or a JSON-LD block. We extract that and hand it to the article pipeline.
 *
 * Apple News+ exclusives have no public web equivalent — we can't fetch
 * those at all, so we surface a clear error.
 */
export async function handleAppleNews(url: string): Promise<Normalized> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        // Apple's splash page returns a near-empty body to bot-like UAs.
        // A standard desktop Safari UA reliably returns the full meta set.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new IngestError(
        "Timed out fetching the Apple News link after 15 seconds."
      );
    }
    throw new IngestError(
      `Couldn't reach the Apple News link: ${err instanceof Error ? err.message : "network error"}.`
    );
  }

  if (!res.ok) {
    throw new IngestError(
      `Apple News returned HTTP ${res.status} (${res.statusText}) for that link.`
    );
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const resolved = findPublisherUrl(doc);
  if (!resolved) {
    throw new IngestError(
      "This looks like an Apple News+ exclusive (magazine or paywalled) piece — " +
        "there's no public web version to extract. Paste the article text directly instead."
    );
  }

  return handleArticle(resolved);
}

function findPublisherUrl(doc: Document): string | null {
  const candidates: string[] = [];

  const canonical = doc
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  if (canonical) candidates.push(canonical);

  const ogUrl = doc
    .querySelector('meta[property="og:url"]')
    ?.getAttribute("content");
  if (ogUrl) candidates.push(ogUrl);

  for (const node of doc.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    const text = node.textContent;
    if (!text) continue;
    try {
      const data: unknown = JSON.parse(text);
      collectJsonLdUrls(data, candidates);
    } catch {
      // ignore malformed blocks
    }
  }

  for (const href of candidates) {
    if (!href) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    if (isAppleNewsHost(href)) continue;
    return href;
  }
  return null;
}

function collectJsonLdUrls(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) collectJsonLdUrls(child, out);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const key of ["url", "@id"]) {
    const v = obj[key];
    if (typeof v === "string") out.push(v);
  }
  const main = obj.mainEntityOfPage;
  if (typeof main === "string") out.push(main);
  else if (main && typeof main === "object") collectJsonLdUrls(main, out);
}
