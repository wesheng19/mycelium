import { Innertube } from "youtubei.js";
import { IngestError } from "./errors";

export type BodyLink = {
  url: string;
  anchorText: string;
};

export type Normalized = {
  title?: string;
  content: string;
  source: "youtube" | "article" | "text";
  url?: string;
  bodyLinks?: BodyLink[];
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

  const fallback =
    buildMetadataContent(info) ?? (await buildOEmbedContent(url));
  if (!fallback) {
    throw new IngestError(
      "Couldn't fetch a transcript or any metadata for this video. " +
        "Paste the content as text instead."
    );
  }
  return {
    title: title ?? fallback.title,
    content: fallback.content,
    source: "youtube",
    url,
  };
}

async function buildOEmbedContent(
  url: string
): Promise<{ title?: string; content: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
    };
    if (!data.title && !data.author_name) return null;
    const lines = [
      "[No transcript and no full metadata were available for this video. The summary below is based only on the video's title and channel.]",
      "",
    ];
    if (data.title) lines.push(`Title: ${data.title}`);
    if (data.author_name) lines.push(`Channel: ${data.author_name}`);
    lines.push(`URL: ${url}`);
    return { title: data.title, content: lines.join("\n") };
  } catch {
    return null;
  }
}

function buildMetadataContent(
  info: Awaited<ReturnType<Innertube["getInfo"]>>
): { title?: string; content: string } | null {
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
  if (lines.length <= 2) return null;
  return { title: b.title ?? undefined, content: lines.join("\n") };
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
