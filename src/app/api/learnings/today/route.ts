import { NextResponse } from "next/server";
import { and, gte, lt, desc } from "drizzle-orm";
import { db, learnings } from "@/lib/db";
import { pacificStartOfDay } from "@/lib/tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 }
    );
  }

  const start = pacificStartOfDay(new Date());
  const end = new Date(start.getTime() + 86_400_000);

  const rows = await db
    .select()
    .from(learnings)
    .where(
      and(gte(learnings.createdAt, start), lt(learnings.createdAt, end))
    )
    .orderBy(desc(learnings.createdAt));

  return NextResponse.json({ entries: rows });
}
