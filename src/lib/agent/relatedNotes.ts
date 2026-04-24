import { generateText, stepCountIs, tool } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { z } from "zod";
import { DEEPSEEK_MODEL, type Summary } from "@/lib/deepseek";
import {
  getNoteSummary,
  searchByQuery,
  searchByTags,
  type NoteCandidate,
} from "@/lib/learnings/queries";

export type RelatedNote = {
  id: string;
  title: string;
  markdownPath: string;
  reason: string;
};

const RESULT_LIMIT = 5;
const STEP_CAP = 15;
const TOOL_LIMIT = 8;

const SYSTEM_PROMPT = `You connect notes in a personal knowledge vault. The user just \
ingested a NEW note (summary below). Your job: find 0-5 EXISTING notes that are \
genuinely related — they share substantive ideas, themes, or entities, not just \
superficial keyword overlap.

Available tools:
- searchByTags: notes sharing one of the given tags (cheap, high-precision)
- searchByQuery: keyword search across titles, tl;drs, and takeaways
- readNoteSummary: full takeaways for one candidate (use sparingly — costs tokens)

Strategy:
1. Start with searchByTags using the new note's tags
2. Use searchByQuery for key concepts/entities not covered by tags
3. For promising candidates, use readNoteSummary to verify substantive overlap
4. Be selective — return [] rather than weak matches

After deciding, output a single JSON array and nothing else:

[
  { "id": "<uuid from a search result>", "reason": "<one short sentence on the connection>" }
]

Rules:
- Only use IDs that appeared in your search results — never invent UUIDs
- Cap at 5 entries; pick the strongest connections
- Each "reason" is one concise sentence (~10-25 words) the reader can scan
- If nothing genuinely connects, return []
- No preamble, no markdown, no commentary outside the JSON array`;

export async function findRelatedNotes(input: {
  summary: Summary;
}): Promise<RelatedNote[]> {
  if (!process.env.DEEPSEEK_API_KEY) return [];
  if (input.summary.tags.length === 0 && !input.summary.tldr) return [];

  const seenIds = new Set<string>();

  const tools = {
    searchByTags: tool({
      description:
        "Find existing vault notes that share at least one of the given tags. " +
        "Returns up to 8 notes sorted by recency.",
      inputSchema: z.object({
        tags: z
          .array(z.string())
          .min(1)
          .describe("Tag names to search by — lowercase, hyphenated."),
      }),
      execute: async ({ tags }) => {
        const rows = await searchByTags(tags, TOOL_LIMIT);
        rows.forEach((r) => seenIds.add(r.id));
        return { found: rows.length, results: rows.map(shape) };
      },
    }),
    searchByQuery: tool({
      description:
        "Keyword search across note titles, tl;drs, and takeaways. " +
        "Use specific phrases (3-6 words). Returns up to 8 matches.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe("Phrase to search for. Be specific — broad words return noise."),
      }),
      execute: async ({ query }) => {
        const rows = await searchByQuery(query, TOOL_LIMIT);
        rows.forEach((r) => seenIds.add(r.id));
        return { found: rows.length, results: rows.map(shape) };
      },
    }),
    readNoteSummary: tool({
      description:
        "Fetch the full takeaways for one candidate note. Use sparingly — only " +
        "when title and tl;dr aren't enough to judge relevance.",
      inputSchema: z.object({
        id: z
          .string()
          .uuid()
          .describe("The note's UUID, from a previous search result."),
      }),
      execute: async ({ id }) => {
        const note = await getNoteSummary(id);
        if (!note) return { found: false as const };
        return {
          found: true as const,
          title: note.title,
          tldr: note.tldr,
          takeaways: note.takeaways ?? [],
          tags: note.tags ?? [],
        };
      },
    }),
  };

  const newNoteContext = [
    `Title: ${input.summary.title}`,
    `Tags: ${input.summary.tags.join(", ") || "(none)"}`,
    `TL;DR: ${input.summary.tldr}`,
    "Takeaways:",
    ...input.summary.takeaways.map((t) => `- ${t}`),
  ].join("\n");

  try {
    const result = await generateText({
      model: deepseek(DEEPSEEK_MODEL),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `New note:\n${newNoteContext}` }],
      tools,
      stopWhen: stepCountIs(STEP_CAP),
    });

    const finalText = lastAssistantText(result);
    const picks = parsePicks(finalText, seenIds);
    if (picks.length === 0) {
      console.log(
        `[related] no links chosen over ${result.steps.length} steps`
      );
      return [];
    }
    const resolved = await resolvePicks(picks);
    console.log(
      `[related] linking ${resolved.length} notes over ${result.steps.length} steps`
    );
    return resolved.slice(0, RESULT_LIMIT);
  } catch (err) {
    console.warn("[related] failed, no links added:", err);
    return [];
  }
}

function shape(c: NoteCandidate) {
  return {
    id: c.id,
    title: c.title,
    tldr: c.tldr,
    tags: c.tags ?? [],
    markdownPath: c.markdownPath,
    createdAt: c.createdAt.toISOString().slice(0, 10),
  };
}

type Pick = { id: string; reason: string };

function parsePicks(text: string, seenIds: Set<string>): Pick[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Pick[] = [];
  const picked = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    if (!id || !reason) continue;
    if (!seenIds.has(id)) continue;
    if (picked.has(id)) continue;
    picked.add(id);
    out.push({ id, reason });
  }
  return out;
}

async function resolvePicks(picks: Pick[]): Promise<RelatedNote[]> {
  const out: RelatedNote[] = [];
  for (const pick of picks) {
    const note = await getNoteSummary(pick.id);
    if (!note?.markdownPath) continue;
    out.push({
      id: pick.id,
      title: note.title,
      markdownPath: note.markdownPath,
      reason: pick.reason,
    });
  }
  return out;
}

function lastAssistantText(result: {
  text: string;
  steps: ReadonlyArray<{ text: string }>;
}): string {
  if (result.text.trim()) return result.text;
  for (let i = result.steps.length - 1; i >= 0; i--) {
    const t = result.steps[i].text;
    if (t && t.trim()) return t;
  }
  return "";
}
