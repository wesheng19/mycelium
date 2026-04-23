import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleYouTube, isYouTubeUrl } from "@/lib/ingest/youtube";
import { handleAppleNews, isAppleNewsUrl } from "@/lib/ingest/appleNews";
import { handleArticle } from "@/lib/ingest/article";
import { handleText } from "@/lib/ingest/text";
import { IngestError } from "@/lib/ingest/errors";
import { summarize, summarizeBookPassage } from "@/lib/deepseek";
import { enrichVocabulary } from "@/lib/agent/vocabulary";
import { findRelatedNotes } from "@/lib/agent/relatedNotes";
import { buildReferences } from "@/lib/agent/references";
import { buildMarkdown, vaultPath } from "@/lib/markdown";
import { commitNote } from "@/lib/vault";
import { appendBookSection } from "@/lib/bookVault";
import { matchBook } from "@/lib/books";
import { db, learnings } from "@/lib/db";

export const runtime = "nodejs";
// Article extraction + DeepSeek calls easily exceed Vercel's default 10s.
export const maxDuration = 60;

type IngestBody = {
  url?: string | string[];
  text?: string;
  book?: string;
  confirmBook?: boolean;
};

function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return undefined;
}

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

  const url = firstString(body.url);
  const text = typeof body.text === "string" ? body.text.trim() || undefined : undefined;
  const book =
    typeof body.book === "string" && body.book.trim()
      ? body.book.trim()
      : undefined;
  const confirmBook = body.confirmBook === true;

  if (!url && !text) {
    return NextResponse.json(
      { error: "Provide a `url` or `text`." },
      { status: 400 }
    );
  }
  if (book && url) {
    return NextResponse.json(
      { error: "Use `book` with pasted `text`, not a `url`." },
      { status: 400 }
    );
  }
  if (book && !text) {
    return NextResponse.json(
      { error: "Book ingest requires pasted `text`." },
      { status: 400 }
    );
  }

  try {
    if (book) {
      return await ingestBookPassage(text!, book, confirmBook);
    }

    const normalized = url
      ? isYouTubeUrl(url)
        ? await handleYouTube(url)
        : isAppleNewsUrl(url)
          ? await handleAppleNews(url)
          : await handleArticle(url)
      : await handleText(text!);

    const summary = await summarize({
      title: normalized.title,
      text: normalized.content,
      source: normalized.source,
      url: normalized.url,
    });

    summary.vocabulary = await enrichVocabulary({
      text: normalized.content,
      candidates: summary.vocabulary,
    });

    const related = await findRelatedNotes({ summary });

    const references =
      normalized.source === "article" && normalized.bodyLinks?.length
        ? await buildReferences({
            summary,
            bodyLinks: normalized.bodyLinks,
          })
        : [];

    const now = new Date();
    const path = vaultPath(now, summary.title);
    const markdown = buildMarkdown({
      summary,
      source: normalized.source,
      url: normalized.url,
      date: now,
      related,
      references,
      selfPath: path,
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
    if (err instanceof IngestError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ingest] unexpected failure:", err);
    return NextResponse.json(
      { ok: false, error: `Something went wrong: ${message}` },
      { status: 500 }
    );
  }
}

async function ingestBookPassage(
  text: string,
  bookInput: string,
  confirmed: boolean
) {
  const match = await matchBook(bookInput);
  if (match.kind === "suggestion" && !confirmed) {
    return NextResponse.json(
      {
        ok: false,
        needsBookConfirmation: true,
        typed: bookInput,
        suggested: match.canonical,
        message: `Did you mean "${match.canonical}"?`,
      },
      { status: 409 }
    );
  }

  const canonical =
    match.kind === "exact"
      ? match.canonical
      : match.kind === "suggestion"
        ? match.canonical
        : bookInput;

  const summary = await summarizeBookPassage({
    book: canonical,
    text,
  });

  summary.vocabulary = await enrichVocabulary({
    text,
    candidates: summary.vocabulary,
  });

  const entryId = randomUUID();
  const now = new Date();
  const path = await appendBookSection(canonical, entryId, summary, now);

  if (db) {
    await db.insert(learnings).values({
      id: entryId,
      source: "book",
      url: null,
      title: summary.title,
      tldr: summary.tldr,
      takeaways: summary.takeaways,
      tags: summary.tags,
      markdownPath: path,
      book: canonical,
    });
  }

  return NextResponse.json({
    ok: true,
    path,
    book: canonical,
    summary,
  });
}

