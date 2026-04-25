import { NextResponse } from "next/server";
import { and, gte, lt, desc } from "drizzle-orm";
import { db, learnings } from "@/lib/db";
import { pacificStartOfDay } from "@/lib/tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DAYS = 90;

export async function GET(req: Request) {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 }
    );
  }

  // ?days=N — N=1 (default) returns just today; N>1 returns the last N days
  // worth of entries (Pacific-Time day boundaries). Capped at MAX_DAYS.
  const url = new URL(req.url);
  const rawDays = Number(url.searchParams.get("days") ?? "1");
  const days = Number.isFinite(rawDays)
    ? Math.min(Math.max(Math.trunc(rawDays), 1), MAX_DAYS)
    : 1;

  const todayStart = pacificStartOfDay(new Date());
  const end = new Date(todayStart.getTime() + 86_400_000);
  const start = new Date(todayStart.getTime() - (days - 1) * 86_400_000);

  const rows = await db
    .select()
    .from(learnings)
    .where(and(gte(learnings.createdAt, start), lt(learnings.createdAt, end)))
    .orderBy(desc(learnings.createdAt));

  return NextResponse.json({ entries: rows, days });
}
