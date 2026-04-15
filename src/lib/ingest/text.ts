import type { Normalized } from "./youtube";

/**
 * Stub. Plain text/note input — title is derived from the first line
 * (or a fallback timestamp) for now.
 */
export async function handleText(text: string): Promise<Normalized> {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  const title = firstLine
    ? firstLine.slice(0, 80)
    : `Note ${new Date().toISOString()}`;

  return {
    title,
    content: text,
    source: "text",
  };
}
