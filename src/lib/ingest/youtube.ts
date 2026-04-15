export type Normalized = {
  title: string;
  content: string;
  source: "youtube" | "article" | "text";
  url?: string;
};

/**
 * Stub. Will use `youtube-transcript` to fetch captions and derive
 * a title from oEmbed (or scrape) once wired up.
 */
export async function handleYouTube(url: string): Promise<Normalized> {
  return {
    title: `YouTube video: ${url}`,
    content: "(transcript fetching not yet implemented)",
    source: "youtube",
    url,
  };
}
