import { generateText } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { DEEPSEEK_MODEL, type Summary } from "@/lib/deepseek";
import type { ImageCandidate } from "@/lib/ingest/youtube";

const ARTICLE_BODY_PICK_LIMIT = 3;

const SYSTEM_PROMPT = `You select 0-3 body images that would help a reader \
understand a freshly-summarized article. The hero image is automatically \
included separately, so focus only on body images.

Pick images that:
- Have meaningful alt text describing a chart, photo, screenshot, or diagram
- Add visual context the summary alone can't convey
- Are not generic stock photos, author headshots, or company logos

Skip images that:
- Have empty/generic alt text ("image", "photo", "img-1234")
- Look like avatars (small people headshots), share buttons, or icons (alt or URL hints)
- Are decorative

Output a single JSON array (and nothing else):

[
  { "url": "<exact url from input>" }
]

Rules:
- URLs must come from the input list (no inventing)
- Cap at 3 entries; pick the most useful
- If no body image is worth including, return []
- No preamble, no markdown, no commentary outside the JSON array`;

export async function pickArticleBodyImages(input: {
  summary: Summary;
  candidates: ImageCandidate[];
}): Promise<ImageCandidate[]> {
  const body = input.candidates.filter((c) => !c.isHero);
  if (body.length === 0) return [];
  if (!process.env.DEEPSEEK_API_KEY) return [];

  const summaryContext = [
    `Title: ${input.summary.title}`,
    `Tags: ${input.summary.tags.join(", ") || "(none)"}`,
    `TL;DR: ${input.summary.tldr}`,
  ].join("\n");

  const candidatesContext = body
    .map(
      (c, i) =>
        `${i + 1}. URL: ${c.url}\n   Alt: ${c.alt ? `"${c.alt}"` : "(empty)"}`
    )
    .join("\n\n");

  try {
    const result = await generateText({
      model: deepseek(DEEPSEEK_MODEL),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `New article summary:\n${summaryContext}\n\n` +
            `Body image candidates:\n${candidatesContext}`,
        },
      ],
    });

    const allowed = new Map(body.map((c) => [c.url, c]));
    const picks = parsePicks(result.text, allowed);
    console.log(
      `[images] picked ${picks.length}/${body.length} body images`
    );
    return picks.slice(0, ARTICLE_BODY_PICK_LIMIT);
  } catch (err) {
    console.warn("[images] picker failed, no body images selected:", err);
    return [];
  }
}

function parsePicks(
  text: string,
  allowed: Map<string, ImageCandidate>
): ImageCandidate[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ImageCandidate[] = [];
  const picked = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url) continue;
    const c = allowed.get(url);
    if (!c) continue;
    if (picked.has(url)) continue;
    picked.add(url);
    out.push(c);
  }
  return out;
}
