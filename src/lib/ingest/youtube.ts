import { Innertube } from "youtubei.js";
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
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs[0] === "shorts" || segs[0] === "embed") return segs[1] ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function handleYouTube(url: string): Promise<Normalized> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new IngestError(
      `Couldn't extract a video ID from that YouTube URL. Check the link and try again.`
    );
  }

  let yt: Innertube;
  try {
    yt = await Innertube.create({ lang: "en" });
  } catch (err) {
    throw new IngestError(
      `Failed to initialize YouTube client: ${err instanceof Error ? err.message : String(err)}.`
    );
  }

  let info: Awaited<ReturnType<typeof yt.getInfo>>;
  try {
    info = await yt.getInfo(videoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/private|unavailable|removed|age/i.test(msg)) {
      throw new IngestError(
        `This YouTube video is unavailable (private, removed, age-restricted, or region-locked).`
      );
    }
    throw new IngestError(`Failed to load YouTube video: ${msg}.`);
  }

  const title = info.basic_info?.title ?? undefined;

  let transcriptText: string;
  try {
    const t = await info.getTranscript();
    const segments =
      t?.transcript?.content?.body?.initial_segments ?? [];
    transcriptText = segments
      .map((s) => s.snippet?.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err);
    if (
      msg.includes("transcript") ||
      msg.includes("caption") ||
      msg.includes("not available")
    ) {
      throw new IngestError(
        "This YouTube video has no captions available (not even auto-generated). " +
          "Paste the content as text, or try a different video."
      );
    }
    throw new IngestError(
      `Failed to fetch transcript: ${err instanceof Error ? err.message : "unknown error"}.`
    );
  }

  if (!transcriptText) {
    throw new IngestError(
      "YouTube returned an empty transcript for this video. " +
        "Paste the content as text instead."
    );
  }

  return {
    title,
    content: transcriptText,
    source: "youtube",
    url,
  };
}
