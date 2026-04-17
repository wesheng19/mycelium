import { YoutubeTranscript } from "youtube-transcript";

export type Normalized = {
  title?: string;
  content: string;
  source: "youtube" | "article" | "text";
  url?: string;
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return YOUTUBE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be" || u.hostname === "www.youtu.be") {
      return u.pathname.slice(1) || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    // /shorts/<id> or /embed/<id>
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs[0] === "shorts" || segs[0] === "embed") return segs[1] ?? null;
    return null;
  } catch {
    return null;
  }
}

async function fetchOEmbedTitle(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { title?: string };
    return typeof data.title === "string" ? data.title : undefined;
  } catch {
    return undefined;
  }
}

export async function handleYouTube(url: string): Promise<Normalized> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`Could not extract YouTube video id from URL: ${url}`);
  }

  const [transcript, title] = await Promise.all([
    YoutubeTranscript.fetchTranscript(videoId),
    fetchOEmbedTitle(url),
  ]);

  const content = transcript
    .map((seg) => seg.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!content) {
    throw new Error("Empty transcript returned for video");
  }

  return {
    title,
    content,
    source: "youtube",
    url,
  };
}
