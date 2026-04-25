import OpenAI from "openai";

/**
 * DeepSeek client. DeepSeek's API is OpenAI-compatible — we point
 * the OpenAI SDK at their base URL.
 *
 * Models: `deepseek-v4-flash` (default), `deepseek-v4-pro`.
 * (`deepseek-chat` and `deepseek-reasoner` are deprecated 2026-07-24.)
 */
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: "https://api.deepseek.com",
});

export const DEEPSEEK_MODEL = "deepseek-v4-flash";

export type SummarizeInput = {
  title?: string;
  text: string;
  source: string;
  url?: string;
};

export type VocabularyEntry = {
  word: string;
  explanation: string;
};

export type Summary = {
  title: string;
  tldr: string;
  detailedSummary: string;
  takeaways: string[];
  tags: string[];
  whyItMatters: string;
  vocabulary: VocabularyEntry[];
};

const SYSTEM_PROMPT = `You are a careful note-taker building a personal "second brain" \
from things the user has just read or watched. The user is a non-native English \
speaker working on their reading comprehension, so you also act as a vocabulary \
tutor. Your goal is to produce a rich, detailed record the user can revisit months \
later and still recall the substance of the source. For each piece of content, \
return strict JSON with the following shape:

{
  "title": string,             // concise, descriptive; use the original title if good
  "tldr": string,              // a dense paragraph, 150-300 words, capturing the core argument/narrative
  "detailedSummary": string,   // a thorough multi-paragraph walkthrough (400-900 words) covering the main sections, evidence, examples, and reasoning in order. Use \\n\\n between paragraphs. Preserve specifics: names, numbers, quotes, definitions, and concrete examples from the source
  "takeaways": string[],       // 5-12 bullets. Each bullet is 1-3 sentences combining the point and a supporting detail, number, or example from the source
  "tags": string[],            // 2-6 lowercase, hyphenated topical tags (no '#')
  "whyItMatters": string,      // 2-4 sentences on relevance, implications, and who should care
  "vocabulary": [              // 5-12 entries an intermediate English learner might not know
    { "word": string, "explanation": string }
  ]
}

Vocabulary guidance:
- Pick less-common words, idioms, phrasal verbs, technical terms, or culturally loaded phrases that appear in the source.
- Skip words a B2-level learner clearly knows (e.g. "important", "people", "difficult").
- "word" is the surface form as it appears in the source (can be a short phrase up to ~5 words).
- "explanation" is one concise English sentence (~10-25 words) giving the meaning in context, plus a brief usage note if the word is idiomatic.
- If the source has no noteworthy vocabulary (very simple text or non-English), return an empty array.

Be concrete and faithful to the source. Prefer specific details over generic paraphrase. \
If the source is short, scale down proportionally, but never invent facts. \
No markdown formatting inside string values, no extra keys, no preamble.`;

function buildUserPrompt(input: SummarizeInput): string {
  const parts: string[] = [];
  parts.push(`Source: ${input.source}`);
  if (input.url) parts.push(`URL: ${input.url}`);
  if (input.title) parts.push(`Original title: ${input.title}`);
  parts.push("");
  parts.push("Content:");
  parts.push(input.text);
  return parts.join("\n");
}

/**
 * Truncate to a reasonable token budget. DeepSeek-chat has a large
 * context window but transcripts can blow past anything sensible.
 * We cut at a character count; cheap and fine for v0.
 */
function truncate(text: string, max = 60_000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[…content truncated]";
}

export async function summarize(input: SummarizeInput): Promise<Summary> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  const trimmed: SummarizeInput = { ...input, text: truncate(input.text) };

  const completion = await deepseek.chat.completions.create({
    model: DEEPSEEK_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(trimmed) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned no content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek did not return valid JSON: ${raw.slice(0, 200)}`);
  }

  return normalizeSummary(parsed, input);
}

const BOOK_SYSTEM_PROMPT = `You are a careful note-taker helping the user build a \
personal reading log for books. The user is a non-native English speaker working on \
reading comprehension, so you also act as a vocabulary tutor. The user has pasted a \
passage, chapter excerpt, or paragraph from a book. Your job is to summarize THIS \
specific passage (not the whole book), while using its context within the book. \
Return strict JSON with this shape:

{
  "title": string,             // a short, descriptive heading for this passage (e.g. "Chapter 3: Orthogonality" or a phrase that captures the passage's core idea)
  "tldr": string,              // 1-3 sentences distilling the passage's point
  "detailedSummary": string,   // 200-600 words walking through the passage's argument or narrative. Preserve specific terms, names, and direct quotes from the passage. Use \\n\\n between paragraphs
  "takeaways": string[],       // 3-8 bullets. Each bullet states an idea from the passage plus a supporting detail or example from the text
  "tags": string[],            // 2-6 lowercase, hyphenated topical tags (no '#')
  "whyItMatters": string,      // 1-3 sentences on how this passage connects to the book's broader argument or to the reader's life
  "vocabulary": [              // 5-12 entries an intermediate English learner might not know
    { "word": string, "explanation": string }
  ]
}

Vocabulary guidance:
- Pick less-common words, idioms, phrasal verbs, literary devices, or culturally loaded phrases that appear in the passage.
- Skip words a B2-level learner clearly knows.
- "word" is the surface form as it appears in the passage (can be a short phrase up to ~5 words).
- "explanation" is one concise English sentence (~10-25 words) giving the meaning in context, plus a brief usage note if the word is idiomatic.
- If the passage has no noteworthy vocabulary, return an empty array.

Be faithful to what's in the passage. Do not invent context from outside the text. \
If the passage is short, scale down proportionally. No markdown inside string values, \
no extra keys, no preamble.`;

export type BookPassageInput = {
  book: string;
  text: string;
};

export async function summarizeBookPassage(
  input: BookPassageInput
): Promise<Summary> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  const userPrompt = [
    `Book: ${input.book}`,
    "",
    "Passage:",
    truncate(input.text, 25_000),
  ].join("\n");

  const completion = await deepseek.chat.completions.create({
    model: DEEPSEEK_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: BOOK_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek returned no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek did not return valid JSON: ${raw.slice(0, 200)}`);
  }

  return normalizeSummary(parsed, {
    text: input.text,
    source: "book",
    title: undefined,
    url: undefined,
  });
}

function normalizeSummary(raw: unknown, input: SummarizeInput): Summary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const asString = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  return {
    title: asString(obj.title, input.title ?? "Untitled"),
    tldr: asString(obj.tldr),
    detailedSummary: asString(obj.detailedSummary ?? obj.detailed_summary),
    takeaways: asStringArray(obj.takeaways),
    tags: asStringArray(obj.tags).map((t) =>
      t.toLowerCase().replace(/^#/, "").trim()
    ),
    whyItMatters: asString(obj.whyItMatters ?? obj.why_it_matters),
    vocabulary: asVocabulary(obj.vocabulary),
  };
}

function asVocabulary(v: unknown): VocabularyEntry[] {
  if (!Array.isArray(v)) return [];
  const out: VocabularyEntry[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const word = typeof o.word === "string" ? o.word.trim() : "";
    const explanation =
      typeof o.explanation === "string" ? o.explanation.trim() : "";
    if (word && explanation) out.push({ word, explanation });
  }
  return out;
}
