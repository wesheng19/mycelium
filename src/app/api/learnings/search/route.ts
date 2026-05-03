import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db, learnings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SOURCES = new Set(["article", "youtube", "text", "book"]);
const MAX_RESULTS = 500;

// The full-text "haystack" — title, tldr, tags joined, takeaways jsonb cast
// to text. The cast is crude (preserves brackets/quotes from JSON encoding)
// but tsvector tokenization treats those as word boundaries, so the real
// content is still searchable. At personal-scale data we run this expression
// per-row at query time; add a GIN index later if it slows down.
const HAYSTACK_SQL = sql`
  to_tsvector('english',
    coalesce(${learnings.title}, '') || ' ' ||
    coalesce(${learnings.tldr}, '') || ' ' ||
    coalesce(array_to_string(${learnings.tags}, ' '), '') || ' ' ||
    coalesce(${learnings.takeaways}::text, '')
  )
`;

export async function GET(req: Request) {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const rawSource = (url.searchParams.get("source") ?? "").trim();
  const source = ALLOWED_SOURCES.has(rawSource) ? rawSource : "";
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD — interpreted as Pacific calendar days,
  // but for filtering we just clamp UTC midnight on those dates. Close enough
  // for archive browsing; "today" view handles strict Pacific boundaries.
  const from = fromStr ? new Date(`${fromStr}T00:00:00Z`) : null;
  const toRaw = toStr ? new Date(`${toStr}T00:00:00Z`) : null;
  const to = toRaw ? new Date(toRaw.getTime() + 86_400_000) : null;

  const conditions: SQL[] = [];
  if (q) conditions.push(sql`${HAYSTACK_SQL} @@ websearch_to_tsquery('english', ${q})`);
  if (tag) conditions.push(sql`${tag} = ANY(${learnings.tags})`);
  if (source) conditions.push(eq(learnings.source, source));
  if (from && !Number.isNaN(from.getTime())) conditions.push(gte(learnings.createdAt, from));
  if (to && !Number.isNaN(to.getTime())) conditions.push(lt(learnings.createdAt, to));

  const rank = q
    ? sql<number>`ts_rank_cd(${HAYSTACK_SQL}, websearch_to_tsquery('english', ${q}))`
    : sql<number>`0`;

  const orderClauses = q
    ? [desc(rank), desc(learnings.createdAt)]
    : [desc(learnings.createdAt)];

  const rows = await db
    .select({
      id: learnings.id,
      createdAt: learnings.createdAt,
      source: learnings.source,
      url: learnings.url,
      title: learnings.title,
      tldr: learnings.tldr,
      takeaways: learnings.takeaways,
      tags: learnings.tags,
      markdownPath: learnings.markdownPath,
      book: learnings.book,
      rank,
    })
    .from(learnings)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderClauses)
    .limit(MAX_RESULTS);

  return NextResponse.json({
    entries: rows,
    total: rows.length,
    query: { q, tag, source, from: fromStr, to: toStr },
    truncated: rows.length === MAX_RESULTS,
  });
}
