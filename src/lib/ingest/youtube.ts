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

  let transcriptText = "";
  try {
    const t = await info.getTranscript();
    const segments =
      t?.transcript?.content?.body?.initial_segments ?? [];
    transcriptText = segments
      .map((s) => s.snippet?.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    // YouTube's get_transcript endpoint is unreliable under anti-scraping
    // changes — swallow and fall through to metadata-only content below.
  }

  if (transcriptText) {
    return { title, content: transcriptText, source: "youtube", url };
  }

  const fallback = buildMetadataContent(info);
  if (!fallback) {
    throw new IngestError(
      "Couldn't fetch a transcript or any metadata for this video. " +
        "Paste the content as text instead."
    );
  }
  return { title, content: fallback, source: "youtube", url };
}

function buildMetadataContent(
  info: Awaited<ReturnType<Innertube["getInfo"]>>
): string | null {
  const b = info.basic_info;
  if (!b) return null;

  const lines: string[] = [
    "[No transcript was available for this video. The summary below is based only on the video's title, channel, and description.]",
    "",
  ];
  if (b.title) lines.push(`Title: ${b.title}`);
  if (b.author) lines.push(`Channel: ${b.author}`);
  if (b.duration) lines.push(`Duration: ${formatDuration(b.duration)}`);
  if (b.category) lines.push(`Category: ${b.category}`);
  if (b.keywords?.length) {
    lines.push(`Tags: ${b.keywords.slice(0, 15).join(", ")}`);
  }
  if (b.short_description?.trim()) {
    lines.push("", "Description:", b.short_description.trim());
  }
  return lines.length > 2 ? lines.join("\n") : null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}h ${m}m ${s}s`
    : m > 0
      ? `${m}m ${s}s`
      : `${s}s`;
}
