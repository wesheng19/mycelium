"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  title: string;
  source: string;
  url: string | null;
  tldr: string | null;
  tags: string[] | null;
  markdownPath: string | null;
  createdAt: string;
};

const SECRET_KEY = "mycelium.ingestSecret";

export default function Home() {
  const [secret, setSecret] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [book, setBook] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [bookSuggestion, setBookSuggestion] = useState<{
    typed: string;
    suggested: string;
  } | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(SECRET_KEY);
    if (stored) {
      setSecret(stored);
    } else {
      const entered = window.prompt("Enter INGEST_SECRET:");
      if (entered) {
        window.localStorage.setItem(SECRET_KEY, entered);
        setSecret(entered);
      }
    }
  }, []);

  async function loadToday() {
    setLoadingEntries(true);
    try {
      const res = await fetch("/api/learnings/today", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { entries: Entry[] };
      setEntries(data.entries);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEntries(false);
    }
  }

  useEffect(() => {
    loadToday();
  }, []);

  async function submitIngest(
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!secret) {
      setError("Missing INGEST_SECRET — refresh and enter it.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setStatus("Capturing…");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingest-secret": secret,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        path?: string;
        needsBookConfirmation?: boolean;
        typed?: string;
        suggested?: string;
      };
      if (
        res.status === 409 &&
        data.needsBookConfirmation &&
        data.typed &&
        data.suggested
      ) {
        setBookSuggestion({ typed: data.typed, suggested: data.suggested });
        setStatus(null);
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }
      setStatus(`Saved → ${data.path}`);
      setUrl("");
      setText("");
      setBook("");
      setBookSuggestion(null);
      await loadToday();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // Long DeepSeek runs sometimes complete on the server but miss the
      // HTTP response window. Refetch the list directly; if a new entry
      // landed we treat it as a soft success.
      const priorIds = new Set(entries.map((e) => e.id));
      let landed = false;
      try {
        const res = await fetch("/api/learnings/today", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { entries: Entry[] };
          setEntries(data.entries);
          landed = data.entries.some((e) => !priorIds.has(e.id));
        }
      } catch {
        // fall through to the plain error message
      }
      if (landed) {
        setStatus(
          "Network dropped, but a new entry landed — it likely saved."
        );
        setError(null);
        setUrl("");
        setText("");
        setBook("");
        setBookSuggestion(null);
      } else {
        setError(message);
        setStatus(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitIngest({
      url: url || undefined,
      text: text || undefined,
      book: book || undefined,
    });
  }

  async function confirmWithBook(chosen: string) {
    await submitIngest({
      text: text || undefined,
      book: chosen,
      confirmBook: true,
    });
  }

  function resetSecret() {
    window.localStorage.removeItem(SECRET_KEY);
    setSecret(null);
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    if (!secret || selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/learnings", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-ingest-secret": secret,
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }
      setSelectMode(false);
      setSelectedIds(new Set());
      await loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={{ marginBottom: "0.25rem" }}>Mycelium</h1>
        <button
          type="button"
          onClick={resetSecret}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          reset secret
        </button>
      </header>
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
          style={inputStyle}
          disabled={!!book}
        />
        <input
          type="text"
          value={book}
          onChange={(e) => setBook(e.target.value)}
          placeholder="Book (optional — append passage to this book's note)"
          style={inputStyle}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            book ? "Paste the passage from the book…" : "Or jot a note / paste text…"
          }
          rows={6}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
        <button
          type="submit"
          disabled={submitting || (!url && !text) || (!!book && !text)}
          style={{
            padding: "0.6rem 1rem",
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: "1rem",
            cursor: submitting ? "not-allowed" : "pointer",
            opacity:
              submitting || (!url && !text) || (!!book && !text) ? 0.6 : 1,
          }}
        >
          {submitting ? "Capturing…" : book ? "Capture passage" : "Capture"}
        </button>
        {status && <p style={{ color: "#1a7f37", margin: 0 }}>{status}</p>}
        {error && <p style={{ color: "#c00", margin: 0 }}>Error: {error}</p>}
        {bookSuggestion && (
          <div
            style={{
              border: "1px solid #e0c97a",
              background: "#fff8e6",
              padding: "0.75rem",
              borderRadius: 6,
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <div>
              Did you mean <strong>{bookSuggestion.suggested}</strong>? You
              typed <em>{bookSuggestion.typed}</em>.
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => confirmWithBook(bookSuggestion.suggested)}
                disabled={submitting}
                style={{
                  padding: "0.35rem 0.75rem",
                  background: "#111",
                  color: "#fff",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                Use &ldquo;{bookSuggestion.suggested}&rdquo;
              </button>
              <button
                type="button"
                onClick={() => confirmWithBook(bookSuggestion.typed)}
                disabled={submitting}
                style={{
                  padding: "0.35rem 0.75rem",
                  background: "#fff",
                  border: "1px solid #ccc",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                Keep &ldquo;{bookSuggestion.typed}&rdquo;
              </button>
              <button
                type="button"
                onClick={() => setBookSuggestion(null)}
                disabled={submitting}
                style={{
                  marginLeft: "auto",
                  padding: "0.35rem 0.75rem",
                  background: "none",
                  border: "none",
                  color: "#888",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>

      <section style={{ marginTop: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "0.5rem",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", margin: 0 }}>
            Today {loadingEntries ? "(…)" : ""}
          </h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {selectMode && selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: "0.3rem 0.75rem",
                  background: "#c00",
                  color: "#fff",
                  border: "none",
                  borderRadius: 5,
                  fontSize: "0.85rem",
                  cursor: deleting ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? "Deleting…" : `Delete ${selectedIds.size}`}
              </button>
            )}
            {entries.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectMode}
                style={{
                  background: "none",
                  border: "1px solid #ddd",
                  borderRadius: 5,
                  padding: "0.3rem 0.6rem",
                  fontSize: "0.8rem",
                  color: selectMode ? "#111" : "#888",
                  cursor: "pointer",
                }}
              >
                {selectMode ? "Cancel" : "Select"}
              </button>
            )}
          </div>
        </div>
        {entries.length === 0 ? (
          <p style={{ color: "#888", marginTop: "0.75rem" }}>No entries yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }}>
            {entries.map((entry) => (
              <li
                key={entry.id}
                onClick={selectMode ? () => toggleId(entry.id) : undefined}
                style={{
                  padding: "0.75rem 0",
                  borderBottom: "1px solid #eee",
                  display: "flex",
                  gap: "0.75rem",
                  alignItems: "flex-start",
                  cursor: selectMode ? "pointer" : "default",
                  background: selectedIds.has(entry.id)
                    ? "#fff8f8"
                    : "transparent",
                }}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    readOnly
                    checked={selectedIds.has(entry.id)}
                    style={{ marginTop: "0.2rem", flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{entry.title}</div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {entry.source}
                    {entry.url ? ` · ${entry.url}` : ""}
                  </div>
                  {entry.tldr && (
                    <div style={{ marginTop: "0.35rem" }}>{entry.tldr}</div>
                  )}
                  {entry.tags && entry.tags.length > 0 && (
                    <div
                      style={{
                        marginTop: "0.35rem",
                        fontSize: "0.8rem",
                        color: "#555",
                      }}
                    >
                      {entry.tags.map((t) => `#${t}`).join(" ")}
                    </div>
                  )}
                  {entry.markdownPath && (
                    <div
                      style={{
                        marginTop: "0.25rem",
                        fontSize: "0.75rem",
                        color: "#888",
                      }}
                    >
                      {entry.markdownPath}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  border: "1px solid #ddd",
  borderRadius: 6,
  fontSize: "1rem",
};
