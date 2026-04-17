import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, learnings } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const expected = process.env.INGEST_SECRET;
  if (!expected || req.headers.get("x-ingest-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 }
    );
  }

  const body = (await req.json()) as { ids?: string[] };
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }

  await db.delete(learnings).where(inArray(learnings.id, ids));

  return NextResponse.json({ ok: true, deleted: ids.length });
}
