import type { Normalized } from "./youtube";

/**
 * Stub. Will fetch the URL, parse with @mozilla/readability + jsdom,
 * and return cleaned article text.
 */
export async function handleArticle(url: string): Promise<Normalized> {
  return {
    title: `Article: ${url}`,
    content: "(article extraction not yet implemented)",
    source: "article",
    url,
  };
}
