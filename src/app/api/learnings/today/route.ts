import { NextResponse } from "next/server";
import { and, gte, lt, desc } from "drizzle-orm";
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

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const rows = await db
    .select()
    .from(learnings)
    .where(
      and(gte(learnings.createdAt, start), lt(learnings.createdAt, end))
    )
    .orderBy(desc(learnings.createdAt));

  return NextResponse.json({ entries: rows });
}
