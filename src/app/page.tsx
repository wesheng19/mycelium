"use client";

import { useState } from "react";

type Entry = {
  id: string;
  title: string;
  source: string;
  url?: string;
  tldr?: string;
  createdAt: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url || undefined,
          text: text || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as Entry;
      setEntries((prev) => [data, ...prev]);
      setUrl("");
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: "0.25rem" }}>Mycelium</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Capture today&rsquo;s learning. Drop a URL or paste a thought.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          marginTop: "1.5rem",
        }}
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (YouTube, article, etc.)"
          style={{
            padding: "0.6rem 0.75rem",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: "1rem",
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or jot a note / paste text…"
          rows={6}
          style={{
            padding: "0.6rem 0.75rem",
            border: "1px solid #ddd",
            borderRadius: 6,
            fontSize: "1rem",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
        <button
          type="submit"
          disabled={submitting || (!url && !text)}
          style={{
            padding: "0.6rem 1rem",
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: "1rem",
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting || (!url && !text) ? 0.6 : 1,
          }}
        >
          {submitting ? "Capturing…" : "Capture"}
        </button>
        {error && (
          <p style={{ color: "#c00", margin: 0 }}>Error: {error}</p>
        )}
      </form>

      <section style={{ marginTop: "2.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Today</h2>
        {entries.length === 0 ? (
          <p style={{ color: "#888" }}>No entries yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {entries.map((entry) => (
              <li
                key={entry.id}
                style={{
                  padding: "0.75rem 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <div style={{ fontWeight: 600 }}>{entry.title}</div>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>
                  {entry.source}
                  {entry.url ? ` · ${entry.url}` : ""}
                </div>
                {entry.tldr && (
                  <div style={{ marginTop: "0.35rem" }}>{entry.tldr}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
