import { NextResponse } from "next/server";
import { isNotNull } from "drizzle-orm";
import { db, learnings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 }
    );
  }

  // Personal-scale data — pull all tag arrays and aggregate in memory rather
  // than wrestle with raw SQL `unnest`. A few hundred rows of `text[]` is
  // negligible network and CPU.
  const rows = await db
    .select({ tags: learnings.tags })
    .from(learnings)
    .where(isNotNull(learnings.tags));

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.tags) continue;
    for (const tag of row.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const tags = Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );

  return NextResponse.json({ tags });
}
