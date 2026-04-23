import { generateText } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import type { Summary } from "@/lib/deepseek";
import type { BodyLink } from "@/lib/ingest/youtube";

export type ReferenceEntry = {
  url: string;
  title: string;
  context: string;
};

const PEEK_TIMEOUT_MS = 3_000;
const PEEK_MAX_BYTES = 100_000;
const RESULT_LIMIT = 5;

const SYSTEM_PROMPT = `You select 0-5 useful references from links found in an \
article's body. The user just summarized the source (new note below). Pick links \
that genuinely add context for the reader: primary sources cited, related work, \
key-term definitions, or substantive follow-up reading. Skip generic links, \
navigation, and self-promotional links unless they're substantive.

Output a single JSON array and nothing else:

[
  { "url": "<exact url from the input list>", "context": "<one short sentence on why a reader of the new note would want to follow this link>" }
]

Rules:
- URLs must come from the input list — never invent URLs
- Cap at 5 entries; pick the most useful
- Each "context" is one sentence, ~10-25 words, framed against the new note
- If nothing genuinely adds value, return []
- No preamble, no markdown, no commentary outside the JSON array`;

type LinkMetadata = {
  url: string;
  anchorText: string;
  title?: string;
  description?: string;
  siteName?: string;
};

export async function buildReferences(input: {
  summary: Summary;
  bodyLinks: BodyLink[];
}): Promise<ReferenceEntry[]> {
  if (!process.env.DEEPSEEK_API_KEY) return [];
  if (input.bodyLinks.length === 0) return [];

  const peeks = await Promise.all(input.bodyLinks.map(peekLink));
  const usable = peeks.filter((p) => p.title || p.description);
  if (usable.length === 0) {
    console.log(
      `[refs] no usable metadata across ${input.bodyLinks.length} candidate links`
    );
    return [];
  }
  const byUrl = new Map(usable.map((p) => [p.url, p]));

  const summaryContext = [
    `Title: ${input.summary.title}`,
    `Tags: ${input.summary.tags.join(", ") || "(none)"}`,
    `TL;DR: ${input.summary.tldr}`,
  ].join("\n");

  const linksContext = usable
    .map((p, i) =>
      [
        `${i + 1}. URL: ${p.url}`,
        `   Anchor text: "${p.anchorText}"`,
        p.title ? `   Title: ${p.title}` : "",
        p.description ? `   Description: ${p.description}` : "",
        p.siteName ? `   Site: ${p.siteName}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  try {
    const result = await generateText({
      model: deepseek("deepseek-chat"),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `New note:\n${summaryContext}\n\n` +
            `Linked sources from the article body:\n${linksContext}`,
        },
      ],
    });

    const picks = parsePicks(result.text, byUrl);
    const resolved: ReferenceEntry[] = [];
    for (const pick of picks) {
      const meta = byUrl.get(pick.url);
      if (!meta) continue;
      resolved.push({
        url: pick.url,
        title: meta.title || meta.anchorText || hostnameOf(pick.url),
        context: pick.context,
      });
    }
    console.log(
      `[refs] picked ${resolved.length}/${usable.length} references`
    );
    return resolved.slice(0, RESULT_LIMIT);
  } catch (err) {
    console.warn("[refs] failed, no references added:", err);
    return [];
  }
}

async function peekLink(link: BodyLink): Promise<LinkMetadata> {
  try {
    const res = await fetch(link.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(PEEK_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MyceliumBot/0.1; +https://github.com/wesheng19/mycelium)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });
    if (!res.ok) return { url: link.url, anchorText: link.anchorText };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) {
      return {
        url: link.url,
        anchorText: link.anchorText,
        title: friendlyContentType(ct, link.url),
      };
    }
    const html = await readCapped(res, PEEK_MAX_BYTES);
    return parseHead(html, link);
  } catch {
    return { url: link.url, anchorText: link.anchorText };
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const total = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk.subarray(0, Math.min(chunk.byteLength, received - offset)), offset);
    offset += chunk.byteLength;
    if (offset >= received) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(total);
}

function parseHead(html: string, link: BodyLink): LinkMetadata {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : html.slice(0, 50_000);
  const title =
    metaContent(head, "og:title") ??
    metaContent(head, "twitter:title") ??
    head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const description =
    metaContent(head, "og:description") ??
    metaContent(head, "twitter:description") ??
    metaContent(head, "description");
  const siteName = metaContent(head, "og:site_name");
  return {
    url: link.url,
    anchorText: link.anchorText,
    title: title ? decodeEntities(title) : undefined,
    description: description ? decodeEntities(description) : undefined,
    siteName: siteName ? decodeEntities(siteName) : undefined,
  };
}

function metaContent(head: string, key: string): string | undefined {
  // Try property/name="key" then content="..."
  const re1 = new RegExp(
    `<meta[^>]*\\b(?:property|name)\\s*=\\s*["']${escapeRegex(key)}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`,
    "i"
  );
  // Try content="..." then property/name="key"
  const re2 = new RegExp(
    `<meta[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\b(?:property|name)\\s*=\\s*["']${escapeRegex(key)}["']`,
    "i"
  );
  const m = head.match(re1) ?? head.match(re2);
  return m?.[1]?.trim() || undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function friendlyContentType(ct: string, url: string): string {
  if (ct.includes("pdf")) return `PDF — ${hostnameOf(url)}`;
  if (ct.startsWith("image/")) return `Image — ${hostnameOf(url)}`;
  if (ct.startsWith("video/")) return `Video — ${hostnameOf(url)}`;
  return hostnameOf(url);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type Pick = { url: string; context: string };

function parsePicks(text: string, allowed: Map<string, LinkMetadata>): Pick[] {
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
    const url = typeof o.url === "string" ? o.url.trim() : "";
    const context = typeof o.context === "string" ? o.context.trim() : "";
    if (!url || !context) continue;
    if (!allowed.has(url)) continue;
    if (picked.has(url)) continue;
    picked.add(url);
    out.push({ url, context });
  }
  return out;
}
