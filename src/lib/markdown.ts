import type { Summary } from "./deepseek";
import { PACIFIC } from "./tz";

export type MarkdownBuildInput = {
  summary: Summary;
  source: string;
  url?: string;
  date: Date;
};

export function slugify(input: string, max = 60): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

export function dateParts(d: Date): { y: string; m: string; day: string; iso: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const { year: y, month: m, day } = parts;
  return { y, m, day, iso: `${y}-${m}-${day}` };
}

export function vaultPath(date: Date, title: string): string {
  const { y, m, iso } = dateParts(date);
  return `${y}/${m}/${iso}-${slugify(title)}.md`;
}

function yamlList(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map((t) => JSON.stringify(t)).join(", ")}]`;
}

function yamlString(s: string): string {
  // Keep it simple — quote everything to dodge edge cases.
  return JSON.stringify(s);
}

export function buildMarkdown(input: MarkdownBuildInput): string {
  const { summary, source, url, date } = input;
  const { iso } = dateParts(date);

  const fm: string[] = [
    "---",
    `date: ${iso}`,
    `source: ${source}`,
  ];
  if (url) fm.push(`url: ${yamlString(url)}`);
  fm.push(`tags: ${yamlList(summary.tags)}`);
  fm.push("---");

  const body: string[] = [
    "",
    `# ${summary.title}`,
    "",
    "## TL;DR",
    summary.tldr || "_(no summary)_",
    "",
    "## Key Takeaways",
    ...(summary.takeaways.length
      ? summary.takeaways.map((t) => `- ${t}`)
      : ["- _(none)_"]),
    "",
    "## Why this matters",
    summary.whyItMatters || "_(not provided)_",
    "",
  ];

  return [...fm, ...body].join("\n");
}
