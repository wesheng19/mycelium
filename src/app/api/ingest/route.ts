import { NextResponse } from "next/server";
import { handleYouTube } from "@/lib/ingest/youtube";
import { handleArticle } from "@/lib/ingest/article";
import { handleText } from "@/lib/ingest/text";

export const runtime = "nodejs";

type IngestBody = {
  url?: string;
  text?: string;
};

function detectSource(url?: string): "youtube" | "article" | "text" {
  if (!url) return "text";
  try {
    const u = new URL(url);
    if (
      u.hostname.includes("youtube.com") ||
      u.hostname.includes("youtu.be")
    ) {
      return "youtube";
    }
    return "article";
  } catch {
    return "text";
  }
}

export async function POST(req: Request) {
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, text } = body;
  if (!url && !text) {
    return NextResponse.json(
      { error: "Provide a `url` or `text`." },
      { status: 400 }
    );
  }

  const source = detectSource(url);

  const normalized =
    source === "youtube"
      ? await handleYouTube(url!)
      : source === "article"
      ? await handleArticle(url!)
      : await handleText(text ?? "");

  // Stub: return a placeholder entry. Wiring DeepSeek + GitHub vault
  // commit + Neon insert comes next.
  const entry = {
    id: crypto.randomUUID(),
    title: normalized.title,
    source: normalized.source,
    url: normalized.url,
    tldr: "(summary pending — DeepSeek not yet wired up)",
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(entry);
}
