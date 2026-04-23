import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db, learnings } from "@/lib/db";

export type NoteCandidate = {
  id: string;
  title: string;
  tldr: string | null;
  tags: string[] | null;
  markdownPath: string | null;
  createdAt: Date;
};

export type NoteSummary = NoteCandidate & {
  takeaways: string[] | null;
  source: string;
  url: string | null;
};

const candidateSelect = {
  id: learnings.id,
  title: learnings.title,
  tldr: learnings.tldr,
  tags: learnings.tags,
  markdownPath: learnings.markdownPath,
  createdAt: learnings.createdAt,
};

export async function searchByTags(
  tags: string[],
  limit = 10,
  excludeId?: string
): Promise<NoteCandidate[]> {
  if (!db || tags.length === 0) return [];
  const conditions = [sql`${learnings.tags} && ${tags}`];
  if (excludeId) conditions.push(ne(learnings.id, excludeId));
  return db
    .select(candidateSelect)
    .from(learnings)
    .where(and(...conditions))
    .orderBy(desc(learnings.createdAt))
    .limit(limit);
}

export async function searchByQuery(
  query: string,
  limit = 10,
  excludeId?: string
): Promise<NoteCandidate[]> {
  if (!db || !query.trim()) return [];
  const pattern = `%${query.trim().replace(/[%_\\]/g, "\\$&")}%`;
  const textMatch = or(
    ilike(learnings.title, pattern),
    ilike(learnings.tldr, pattern),
    sql`${learnings.takeaways}::text ILIKE ${pattern}`
  )!;
  const conditions = [textMatch];
  if (excludeId) conditions.push(ne(learnings.id, excludeId));
  return db
    .select(candidateSelect)
    .from(learnings)
    .where(and(...conditions))
    .orderBy(desc(learnings.createdAt))
    .limit(limit);
}

export async function getNoteSummary(id: string): Promise<NoteSummary | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(learnings)
    .where(eq(learnings.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    tldr: r.tldr,
    tags: r.tags,
    markdownPath: r.markdownPath,
    createdAt: r.createdAt,
    takeaways: r.takeaways,
    source: r.source,
    url: r.url,
  };
}
