import { NextResponse } from "next/server";
import { handleYouTube, isYouTubeUrl } from "@/lib/ingest/youtube";
import { handleArticle } from "@/lib/ingest/article";
import { handleText } from "@/lib/ingest/text";
import { summarize } from "@/lib/deepseek";
import { buildMarkdown, vaultPath } from "@/lib/markdown";
import { commitNote } from "@/lib/vault";
import { db, learnings } from "@/lib/db";

export const runtime = "nodejs";
// Article extraction + DeepSeek calls easily exceed Vercel's default 10s.
export const maxDuration = 60;

type IngestBody = {
  url?: string;
  text?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "INGEST_SECRET not configured" },
      { status: 500 }
    );
  }
  const provided = req.headers.get("x-ingest-secret");
  if (provided !== expected) return unauthorized();

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim() || undefined;
  const text = body.text?.trim() || undefined;
  if (!url && !text) {
    return NextResponse.json(
      { error: "Provide a `url` or `text`." },
      { status: 400 }
    );
  }

  try {
    const normalized = url
      ? isYouTubeUrl(url)
        ? await handleYouTube(url)
        : await handleArticle(url)
      : await handleText(text!);

    const summary = await summarize({
      title: normalized.title,
      text: normalized.content,
      source: normalized.source,
      url: normalized.url,
    });

    const now = new Date();
    const path = vaultPath(now, summary.title);
    const markdown = buildMarkdown({
      summary,
      source: normalized.source,
      url: normalized.url,
      date: now,
    });

    await commitNote(path, markdown, `add ${path}`);

    if (db) {
      await db.insert(learnings).values({
        source: normalized.source,
        url: normalized.url,
        title: summary.title,
        tldr: summary.tldr,
        takeaways: summary.takeaways,
        tags: summary.tags,
        markdownPath: path,
      });
    }

    return NextResponse.json({
      ok: true,
      path,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ingest] failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
