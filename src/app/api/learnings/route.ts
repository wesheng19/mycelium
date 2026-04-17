import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, learnings } from "@/lib/db";
import { deleteNote } from "@/lib/vault";

export const runtime = "nodejs";
// Vault deletes hit the GitHub API once per file; bump past the 10s default.
export const maxDuration = 60;

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

  const rows = await db
    .select({ id: learnings.id, markdownPath: learnings.markdownPath })
    .from(learnings)
    .where(inArray(learnings.id, ids));

  await db.delete(learnings).where(inArray(learnings.id, ids));

  let vaultDeleted = 0;
  let vaultFailed = 0;
  await Promise.all(
    rows.map(async (row) => {
      if (!row.markdownPath) return;
      const ok = await deleteNote(
        row.markdownPath,
        `remove ${row.markdownPath}`
      );
      if (ok) vaultDeleted++;
      else vaultFailed++;
    })
  );

  return NextResponse.json({
    ok: true,
    deleted: rows.length,
    vaultDeleted,
    vaultFailed,
  });
}
