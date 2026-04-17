import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { IngestError } from "./errors";
import type { Normalized } from "./youtube";

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

  return {
    title: parsed.title ?? undefined,
    content,
    source: "article",
    url,
  };
}
