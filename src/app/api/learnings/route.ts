import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, learnings } from "@/lib/db";
import { deleteNote } from "@/lib/vault";
import { removeBookSections } from "@/lib/bookVault";

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

  const bookGroups = new Map<string, string[]>();
  const singleFiles: string[] = [];
  for (const row of rows) {
    if (!row.markdownPath) continue;
    if (row.markdownPath.startsWith("books/")) {
      const list = bookGroups.get(row.markdownPath) ?? [];
      list.push(row.id);
      bookGroups.set(row.markdownPath, list);
    } else {
      singleFiles.push(row.markdownPath);
    }
  }

  let vaultDeleted = 0;
  let vaultFailed = 0;

  const work: Promise<void>[] = [];
  for (const path of singleFiles) {
    work.push(
      deleteNote(path, `remove ${path}`).then((ok) => {
        if (ok) vaultDeleted++;
        else vaultFailed++;
      })
    );
  }
  for (const [path, entryIds] of bookGroups) {
    work.push(
      removeBookSections(path, entryIds).then((ok) => {
        if (ok) vaultDeleted++;
        else vaultFailed++;
      })
    );
  }
  await Promise.all(work);

  return NextResponse.json({
    ok: true,
    deleted: rows.length,
    vaultDeleted,
    vaultFailed,
  });
}
