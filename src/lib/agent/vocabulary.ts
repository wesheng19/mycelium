import { generateText, stepCountIs, tool } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { z } from "zod";
import type { VocabularyEntry } from "@/lib/deepseek";

type DictDefinition = { definition?: string; example?: string };
type DictMeaning = { partOfSpeech?: string; definitions?: DictDefinition[] };
type DictEntry = { meanings?: DictMeaning[] };

const DICT_TIMEOUT_MS = 5_000;
const SOURCE_EXCERPT_CHARS = 12_000;
const STEP_CAP = 20;

const lookupTerm = tool({
  description:
    "Look up an English word in a dictionary. Returns parts of speech, " +
    "definitions, and example sentences. Best for single common-ish words. " +
    "Multi-word phrases, proper nouns, slang, and very new terms usually " +
    "return not_found — handle those from source context instead.",
  inputSchema: z.object({
    word: z
      .string()
      .min(1)
      .describe(
        "The word to look up. Use the base/lemma form (e.g. 'run' not " +
          "'running', 'be' not 'were')."
      ),
  }),
  execute: async ({ word }) => {
    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        { signal: AbortSignal.timeout(DICT_TIMEOUT_MS) }
      );
      if (res.status === 404) return { found: false as const };
      if (!res.ok) {
        return { found: false as const, error: `status ${res.status}` };
      }
      const data = (await res.json()) as DictEntry[];
      const meanings = data
        .flatMap((e) => e.meanings ?? [])
        .slice(0, 3)
        .map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: (m.definitions ?? []).slice(0, 2).map((d) => ({
            definition: d.definition,
            example: d.example,
          })),
        }));
      return { found: true as const, meanings };
    } catch (err) {
      return {
        found: false as const,
        error: err instanceof Error ? err.message : "fetch failed",
      };
    }
  },
});

const SYSTEM_PROMPT = `You are an English vocabulary tutor for an intermediate ESL \
learner who just read the source below. A first-pass summarizer flagged candidate \
vocabulary terms; your job is to produce one concise, accurate explanation per \
candidate, grounded in how the word is used in the source.

Use the lookupTerm tool when:
- You want to verify a word's exact meaning or pick the right sense
- The candidate is a single common-ish English word
- You are not 100% sure of the meaning

Skip the tool when:
- The candidate is a multi-word phrase or idiom (dictionary won't have it)
- The candidate is a proper noun, brand, or specialized jargon — explain from source context

After processing all candidates, output a single JSON array and nothing else:

[
  { "word": "<exact surface form from candidate list>", "explanation": "<10-25 word explanation>" }
]

Rules:
- Preserve the exact word surface form from the candidate list (case, plurality, suffixes)
- One sentence per explanation, ~10-25 words, grounded in source usage
- Do not drop any candidate; produce one entry for every word given
- No preamble, no markdown, no commentary outside the JSON array`;

export async function enrichVocabulary(input: {
  text: string;
  candidates: VocabularyEntry[];
}): Promise<VocabularyEntry[]> {
  if (input.candidates.length === 0) return [];
  if (!process.env.DEEPSEEK_API_KEY) return input.candidates;

  const candidatesList = input.candidates
    .map((c, i) => `${i + 1}. ${c.word}`)
    .join("\n");
  const sourceExcerpt = input.text.slice(0, SOURCE_EXCERPT_CHARS);

  try {
    const result = await generateText({
      model: deepseek("deepseek-chat"),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Source excerpt:\n${sourceExcerpt}\n\n` +
            `Candidate vocabulary (preserve these exact surface forms):\n${candidatesList}`,
        },
      ],
      tools: { lookupTerm },
      stopWhen: stepCountIs(STEP_CAP),
    });

    const enriched = parseJsonArray(result.text);
    if (enriched.length === 0) {
      console.warn(
        "[vocab-agent] no usable JSON in response, falling back to original candidates"
      );
      return input.candidates;
    }
    console.log(
      `[vocab-agent] enriched ${enriched.length}/${input.candidates.length} ` +
        `candidates over ${result.steps.length} steps`
    );
    return enriched;
  } catch (err) {
    console.warn("[vocab-agent] enrichment failed, using fallback:", err);
    return input.candidates;
  }
}

function parseJsonArray(text: string): VocabularyEntry[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: VocabularyEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const word = typeof o.word === "string" ? o.word.trim() : "";
    const explanation =
      typeof o.explanation === "string" ? o.explanation.trim() : "";
    if (word && explanation) out.push({ word, explanation });
  }
  return out;
}
