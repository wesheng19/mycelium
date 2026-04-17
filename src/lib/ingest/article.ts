import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { Normalized } from "./youtube";

export async function handleArticle(url: string): Promise<Normalized> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // Some sites block default fetch UAs.
      "User-Agent":
        "Mozilla/5.0 (compatible; MyceliumBot/0.1; +https://github.com/wesheng19/mycelium)",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const parsed = reader.parse();

  if (!parsed || !parsed.textContent) {
    throw new Error("Readability could not extract article content");
  }

  const content = parsed.textContent.replace(/\s+\n/g, "\n").trim();

  return {
    title: parsed.title ?? undefined,
    content,
    source: "article",
    url,
  };
}
