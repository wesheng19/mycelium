import { YoutubeTranscript } from "youtube-transcript";
import { IngestError } from "./errors";

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
    throw new IngestError(
      `Couldn't extract a video ID from that YouTube URL. Check the link and try again.`
    );
  }

  let transcript: { text: string }[];
  try {
    transcript = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.toLowerCase() : String(err);
    if (
      msg.includes("disabled") ||
      msg.includes("not available") ||
      msg.includes("no transcript") ||
      msg.includes("could not get")
    ) {
      throw new IngestError(
        "This YouTube video doesn't have a transcript available. " +
          "Try a different video or paste the content as text."
      );
    }
    throw new IngestError(
      `Failed to fetch transcript for this video: ${err instanceof Error ? err.message : "unknown error"}. ` +
        "The video may be private, age-restricted, or region-locked."
    );
  }

  const title = await fetchOEmbedTitle(url);

  const content = transcript
    .map((seg) => seg.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!content) {
    throw new IngestError(
      "YouTube returned an empty transcript for this video. " +
        "Try a different video or paste the content as text."
    );
  }

  return {
    title,
    content,
    source: "youtube",
    url,
  };
}
