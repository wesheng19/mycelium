import { isNotNull, sql } from "drizzle-orm";
import { db, learnings } from "./db";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export async function listBookTitles(): Promise<string[]> {
  if (!db) return [];
  const rows = await db
    .selectDistinct({ book: learnings.book })
    .from(learnings)
    .where(isNotNull(learnings.book));
  return rows
    .map((r) => r.book)
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export type BookMatch =
  | { kind: "exact"; canonical: string }
  | { kind: "suggestion"; canonical: string; distance: number }
  | { kind: "new" };

/**
 * Look up whether the input matches an existing book in the DB.
 * - `exact`: canonical spelling matches (ignoring case/punctuation)
 * - `suggestion`: close fuzzy match — caller should ask the user to confirm
 * - `new`: no plausible match, treat as a brand-new book
 */
export async function matchBook(input: string): Promise<BookMatch> {
  const inputN = normalize(input);
  if (!inputN) return { kind: "new" };

  const existing = await listBookTitles();
  let best: { canonical: string; distance: number } | null = null;

  for (const canonical of existing) {
    const existingN = normalize(canonical);
    if (existingN === inputN) {
      return { kind: "exact", canonical };
    }
    const d = levenshtein(inputN, existingN);
    if (best === null || d < best.distance) {
      best = { canonical, distance: d };
    }
  }

  if (!best) return { kind: "new" };

  // Allow more slop for longer titles.
  const threshold = Math.max(2, Math.floor(inputN.length * 0.25));
  if (best.distance <= threshold) {
    return {
      kind: "suggestion",
      canonical: best.canonical,
      distance: best.distance,
    };
  }
  return { kind: "new" };
}

// Re-export raw sql helper in case callers need it.
export { sql };
