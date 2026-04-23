import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { IngestError } from "./errors";
import type { BodyLink, Normalized } from "./youtube";

const BODY_LINK_CAP = 12;

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

  return {
    title: parsed.title ?? undefined,
    content,
    source: "article",
    url,
    bodyLinks,
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
