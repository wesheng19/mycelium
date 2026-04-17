import type { Normalized } from "./youtube";

export async function handleText(text: string): Promise<Normalized> {
  return {
    title: undefined,
    content: text,
    source: "text",
  };
}
