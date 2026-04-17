import OpenAI from "openai";

/**
 * DeepSeek client. DeepSeek's API is OpenAI-compatible — we point
 * the OpenAI SDK at their base URL.
 *
 * Models: `deepseek-chat`, `deepseek-reasoner`.
 */
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: "https://api.deepseek.com",
});

export const DEEPSEEK_MODEL = "deepseek-chat";

export type SummarizeInput = {
  title?: string;
  text: string;
  source: string;
  url?: string;
};

export type Summary = {
  title: string;
  tldr: string;
  detailedSummary: string;
  takeaways: string[];
  tags: string[];
  whyItMatters: string;
};

const SYSTEM_PROMPT = `You are a careful note-taker building a personal "second brain" \
from things the user has just read or watched. Your goal is to produce a rich, \
detailed record the user can revisit months later and still recall the substance \
of the source. For each piece of content, return strict JSON with the following shape:

{
  "title": string,             // concise, descriptive; use the original title if good
  "tldr": string,              // a dense paragraph, 150-300 words, capturing the core argument/narrative
  "detailedSummary": string,   // a thorough multi-paragraph walkthrough (400-900 words) covering the main sections, evidence, examples, and reasoning in order. Use \\n\\n between paragraphs. Preserve specifics: names, numbers, quotes, definitions, and concrete examples from the source
  "takeaways": string[],       // 5-12 bullets. Each bullet is 1-3 sentences combining the point and a supporting detail, number, or example from the source
  "tags": string[],            // 2-6 lowercase, hyphenated topical tags (no '#')
  "whyItMatters": string       // 2-4 sentences on relevance, implications, and who should care
}

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
  };
}
