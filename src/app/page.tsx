"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type Mode = "link" | "video" | "book" | "note";
type Theme = "paper" | "ink";

const SECRET_KEY = "mycelium.ingestSecret";
const THEME_KEY = "mycelium.theme";

const SOURCE_META: Record<string, { glyph: string; label: string }> = {
  book: { glyph: "❦", label: "Book" },
  article: { glyph: "§", label: "Article" },
  youtube: { glyph: "▶", label: "Video" },
  text: { glyph: "✱", label: "Note" },
  note: { glyph: "✱", label: "Note" },
};

const PHASES = ["Reading…", "Fetching…", "Distilling…", "Tagging…", "Filing…"];

export default function Home() {
  const [secret, setSecret] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("paper");

  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [book, setBook] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachStatus, setAttachStatus] = useState<{
    id: string;
    ok: boolean;
    msg: string;
  } | null>(null);

  const [recentEntries, setRecentEntries] = useState<Entry[]>([]);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentLoaded, setRecentLoaded] = useState(false);

  const [bookSuggestion, setBookSuggestion] = useState<{
    typed: string;
    suggested: string;
  } | null>(null);

  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- secret bootstrap (preserved) ----
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
    const storedTheme = window.localStorage.getItem(THEME_KEY) as Theme | null;
    if (storedTheme === "ink" || storedTheme === "paper") setTheme(storedTheme);
  }, []);

  function flipTheme() {
    setTheme((t) => {
      const next: Theme = t === "ink" ? "paper" : "ink";
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }

  function resetSecret() {
    window.localStorage.removeItem(SECRET_KEY);
    setSecret(null);
  }

  // ---- load entries ----
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

  // ---- auto-detect youtube → video mode ----
  useEffect(() => {
    if (url && /youtu\.?be/i.test(url) && mode === "link") setMode("video");
  }, [url, mode]);

  // ---- autogrow textarea ----
  useEffect(() => {
    const ta = textRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 400) + "px";
  }, [text]);

  // ---- fake progress while submitting ----
  useEffect(() => {
    if (!submitting) {
      setProgress(0);
      return;
    }
    let p = 0;
    let i = 0;
    setPhase(PHASES[0]);
    const id = window.setInterval(() => {
      p = Math.min(92, p + Math.random() * 18);
      setProgress(p);
      i = Math.min(PHASES.length - 1, i + (Math.random() > 0.5 ? 1 : 0));
      setPhase(PHASES[i]);
    }, 450);
    return () => window.clearInterval(id);
  }, [submitting]);

  // ---- ⌘↵ submit ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const btn = document.querySelector(
          ".btn-primary"
        ) as HTMLButtonElement | null;
        btn?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- mode switching clears irrelevant fields ----
  function switchMode(next: Mode) {
    setMode(next);
    if (next === "note") {
      setUrl("");
      setBook("");
    } else if (next !== "book") {
      // link/video: keep url, clear book
      setBook("");
    }
    // book: keep both — user picks URL or passage
  }

  const trimmedUrl = url.trim();
  const trimmedText = text.trim();
  const trimmedBook = book.trim();
  const canSubmit =
    mode === "link" || mode === "video"
      ? !!trimmedUrl
      : mode === "book"
      ? !!(
          trimmedBook &&
          (trimmedUrl || trimmedText) &&
          !(trimmedUrl && trimmedText)
        )
      : mode === "note"
      ? !!trimmedText
      : false;

  // ---- submit (preserves real API behavior) ----
  async function submitIngest(payload: Record<string, unknown>): Promise<void> {
    if (!secret) {
      setError("Missing INGEST_SECRET — refresh and enter it.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setStatus(null);
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
      setStatus(`Filed → ${data.path}`);
      setUrl("");
      setText("");
      setBook("");
      setBookSuggestion(null);
      const before = new Set(entries.map((e) => e.id));
      await loadToday();
      // mark whichever new entry just landed
      try {
        const r = await fetch("/api/learnings/today", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { entries: Entry[] };
          const fresh = d.entries.find((e) => !before.has(e.id));
          if (fresh) {
            setJustAddedId(fresh.id);
            window.setTimeout(() => setJustAddedId(null), 2600);
          }
        }
      } catch {}
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // soft-success refetch — long DeepSeek runs may complete past the
      // HTTP response window; if a new entry landed, treat it as success
      const priorIds = new Set(entries.map((e) => e.id));
      let landed = false;
      try {
        const res = await fetch("/api/learnings/today", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { entries: Entry[] };
          setEntries(data.entries);
          const fresh = data.entries.find((e) => !priorIds.has(e.id));
          if (fresh) {
            landed = true;
            setJustAddedId(fresh.id);
            window.setTimeout(() => setJustAddedId(null), 2600);
          }
        }
      } catch {
        // fall through
      }
      if (landed) {
        setStatus("Network dropped, but a new entry landed — it likely saved.");
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

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit || submitting) return;
    if (mode === "link" || mode === "video") {
      await submitIngest({ url: trimmedUrl });
    } else if (mode === "book") {
      await submitIngest(
        trimmedUrl
          ? { book: trimmedBook, url: trimmedUrl }
          : { book: trimmedBook, text: trimmedText }
      );
    } else {
      await submitIngest({ text: trimmedText });
    }
  }

  async function confirmWithBook(chosen: string) {
    await submitIngest(
      trimmedUrl
        ? { url: trimmedUrl, book: chosen, confirmBook: true }
        : { text: trimmedText, book: chosen, confirmBook: true }
    );
  }

  // ---- delete ----
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
  async function loadRecent() {
    setRecentLoading(true);
    try {
      const res = await fetch("/api/learnings/today?days=30", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { entries: Entry[] };
      setRecentEntries(data.entries);
      setRecentLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setRecentLoading(false);
    }
  }

  async function toggleRecent() {
    if (!recentExpanded && !recentLoaded) {
      await loadRecent();
    }
    setRecentExpanded((v) => !v);
  }

  async function attachFiles(entryId: string, fileList: FileList | null) {
    if (!secret) {
      setError("Missing INGEST_SECRET — refresh and enter it.");
      return;
    }
    if (!fileList || fileList.length === 0) return;
    setAttachingId(entryId);
    setAttachStatus(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(fileList)) fd.append("file", f);
      const res = await fetch(`/api/learnings/${entryId}/images`, {
        method: "POST",
        headers: { "x-ingest-secret": secret },
        body: fd,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        attached?: { vaultPath: string }[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }
      const n = data.attached?.length ?? 0;
      setAttachStatus({
        id: entryId,
        ok: true,
        msg: `Attached ${n} image${n === 1 ? "" : "s"}`,
      });
      window.setTimeout(() => setAttachStatus(null), 3000);
    } catch (err) {
      setAttachStatus({
        id: entryId,
        ok: false,
        msg: err instanceof Error ? err.message : "Attach failed",
      });
    } finally {
      setAttachingId(null);
    }
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

  // ---- derived ----
  const counts = useMemo(() => {
    const c: Record<string, number> = { book: 0, article: 0, youtube: 0, note: 0 };
    entries.forEach((e) => {
      const k = e.source === "text" ? "note" : e.source;
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [entries]);

  const recentByDay = useMemo(() => {
    const todayIds = new Set(entries.map((e) => e.id));
    const groups = new Map<string, Entry[]>();
    for (const e of recentEntries) {
      if (todayIds.has(e.id)) continue;
      const day = pacificDateKey(e.createdAt);
      const list = groups.get(day);
      if (list) list.push(e);
      else groups.set(day, [e]);
    }
    return Array.from(groups.entries()).map(([day, list]) => ({ day, list }));
  }, [recentEntries, entries]);

  function renderEntry(entry: Entry, idxLabel: string) {
    const meta = SOURCE_META[entry.source] || SOURCE_META.note;
    const isOpen = expanded === entry.id;
    const isSel = selectedIds.has(entry.id);
    const isNew = justAddedId === entry.id;
    return (
      <li
        key={entry.id}
        className={`entry ${isOpen ? "open" : ""} ${isSel ? "selected" : ""} ${isNew ? "just-added" : ""}`}
        onClick={() => {
          if (selectMode) toggleId(entry.id);
          else setExpanded(isOpen ? null : entry.id);
        }}
      >
        <div className="entry-index">
          <span className="idx-num">{idxLabel}</span>
          <span className="idx-time">{clockTime(entry.createdAt)}</span>
        </div>
        <div className="entry-thread" aria-hidden>
          <span className="node" />
          <span className="line" />
        </div>
        <div className="entry-body">
          <div className="entry-top">
            <div className="entry-src">
              <span className="glyph">{meta.glyph}</span>
              <span className="src-label">{meta.label}</span>
              {entry.url && (
                <span className="src-extra">· {domainOf(entry.url)}</span>
              )}
              <span className="dot">·</span>
              <span className="rel-time">{relTime(entry.createdAt)}</span>
            </div>
            <div className="entry-top-right">
              {!selectMode && (
                <label
                  className={`attach-btn ${attachingId === entry.id ? "busy" : ""}`}
                  title="Attach images to this entry"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                    hidden
                    disabled={attachingId === entry.id}
                    onChange={(e) => {
                      const files = e.target.files;
                      e.target.value = "";
                      void attachFiles(entry.id, files);
                    }}
                  />
                  {attachingId === entry.id ? "…" : "📎"}
                </label>
              )}
              {selectMode && (
                <span className={`check ${isSel ? "on" : ""}`} aria-hidden>
                  {isSel ? "✓" : ""}
                </span>
              )}
            </div>
          </div>
          {attachStatus?.id === entry.id && (
            <div
              className={`attach-status ${attachStatus.ok ? "ok" : "err"}`}
              onClick={(e) => e.stopPropagation()}
            >
              {attachStatus.msg}
            </div>
          )}
          <h3 className="entry-title">{entry.title}</h3>
          {entry.tldr && <p className="entry-tldr">{entry.tldr}</p>}
          {entry.tags && entry.tags.length > 0 && (
            <div className="entry-tags">
              {entry.tags.map((t) => (
                <span className="tag" key={t}>
                  #{t}
                </span>
              ))}
            </div>
          )}
          {isOpen && (
            <div className="entry-expand" onClick={(e) => e.stopPropagation()}>
              <div className="expand-grid">
                {entry.markdownPath && (
                  <div>
                    <div className="meta-k">Filed</div>
                    <div className="meta-v mono">{entry.markdownPath}</div>
                  </div>
                )}
                <div>
                  <div className="meta-k">Captured</div>
                  <div className="meta-v mono">
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
                {entry.url && (
                  <div>
                    <div className="meta-k">Source</div>
                    <div className="meta-v mono">{entry.url}</div>
                  </div>
                )}
              </div>
              {entry.url && (
                <div className="expand-actions">
                  <a
                    className="btn-ghost small"
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    open source ↗
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <div
      className={`shell ${theme === "ink" ? "theme-ink" : "theme-paper"} density-cozy`}
      data-theme={theme}
    >
      <MyceliumThreads seed={1578} />
      <div className="grain" aria-hidden />

      {/* masthead */}
      <header className="masthead">
        <div className="mast-left">
          <div className="logomark" aria-hidden>
            <Logomark />
          </div>
          <div>
            <h1 className="wordmark">Mycelium</h1>
            <div className="tagline">A field journal for things worth remembering</div>
          </div>
        </div>
        <div className="mast-right">
          <div className="datestamp">
            <div className="kicker">Vol. II · Entry Log</div>
            <div className="date">{todayLabel()}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="ghost-btn" onClick={flipTheme}>
              {theme === "ink" ? "paper" : "ink"}
            </button>
            <button className="ghost-btn" onClick={resetSecret}>
              reset secret
            </button>
          </div>
        </div>
      </header>

      <div className="double-rule" aria-hidden>
        <span />
        <span />
      </div>

      {/* stats */}
      <div className="stats">
        <Stat label="Today" value={entries.length} unit={entries.length === 1 ? "entry" : "entries"} />
        <Stat label="Books" value={counts.book} />
        <Stat label="Articles" value={counts.article} />
        <Stat label="Videos" value={counts.youtube} />
        <Stat label="Notes" value={counts.note} />
      </div>

      {/* capture */}
      <section className="capture">
        <div className="capture-label">
          <span className="num">01</span>
          <span>Capture</span>
          <span className="sub">— choose a kind, then fill what fits</span>
        </div>

        <div className="mode-picker" role="tablist">
          {(
            [
              { id: "link", label: "Link", hint: "article, paper", icon: <IconLink /> },
              { id: "video", label: "Video", hint: "youtube, lecture", icon: <IconVideo /> },
              { id: "book", label: "Book", hint: "append a passage", icon: <IconBook /> },
              { id: "note", label: "Note", hint: "a thought, a quote", icon: <IconNote /> },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={`mode-tile ${mode === m.id ? "on" : ""}`}
              onClick={() => switchMode(m.id)}
            >
              <span className="mt-icon" aria-hidden>{m.icon}</span>
              <span className="mt-label">{m.label}</span>
              <span className="mt-hint">{m.hint}</span>
              <span className="mt-mark" aria-hidden />
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="capture-form">
          {(mode === "link" || mode === "video") && (
            <div className="field with-icon">
              <span className="field-icon" aria-hidden>
                {mode === "video" ? <IconVideo /> : <IconLink />}
              </span>
              <label>{mode === "video" ? "Video URL" : "Link"}</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  mode === "video"
                    ? "https://youtube.com/watch?v=…"
                    : "https:// — paper, article, essay, post"
                }
                spellCheck={false}
                autoFocus
              />
              {trimmedUrl && (
                <div className="field-meta">
                  <span className="src-glyph">{mode === "video" ? "▶" : "↗"}</span>
                  <span>{domainOf(trimmedUrl)}</span>
                  <span className="dot-sep">·</span>
                  <span>we&rsquo;ll fetch{mode === "video" ? " + transcribe" : ""} + distill</span>
                </div>
              )}
            </div>
          )}

          {mode === "book" && (
            <>
              <div className="field with-icon">
                <span className="field-icon" aria-hidden><IconBook /></span>
                <label>Book title</label>
                <input
                  type="text"
                  value={book}
                  onChange={(e) => setBook(e.target.value)}
                  placeholder="e.g. The Whole-Brain Child"
                  autoFocus
                />
              </div>
              <div className="field with-icon">
                <span className="field-icon" aria-hidden><IconLink /></span>
                <label>Tab URL <span className="hint">— optional, fill this OR a passage</span></label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https:// — article-style page"
                  spellCheck={false}
                  disabled={!!trimmedText}
                />
              </div>
            </>
          )}

          {(mode === "note" || mode === "book") && (
            <div className="field with-icon">
              <span className="field-icon" aria-hidden>
                {mode === "book" ? <IconQuote /> : <IconNote />}
              </span>
              <label>{mode === "book" ? "Passage" : "Note"}</label>
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  mode === "book"
                    ? "…or paste a passage verbatim"
                    : "Jot a thought. Paste text. Think out loud."
                }
                rows={4}
                spellCheck
                autoFocus={mode === "note"}
                disabled={mode === "book" && !!trimmedUrl}
              />
              <div className="field-meta flex-between">
                <span>{text ? `${text.trim().split(/\s+/).filter(Boolean).length} words` : "—"}</span>
                <span className="hint">⌘↵ to capture</span>
              </div>
            </div>
          )}

          {bookSuggestion && (
            <div className="suggestion">
              <div>
                Did you mean <strong>{bookSuggestion.suggested}</strong>? You typed{" "}
                <em>{bookSuggestion.typed}</em>.
              </div>
              <div className="suggestion-actions">
                <button
                  type="button"
                  className="btn-primary small"
                  disabled={submitting}
                  onClick={() => confirmWithBook(bookSuggestion.suggested)}
                >
                  Use &ldquo;{bookSuggestion.suggested}&rdquo;
                </button>
                <button
                  type="button"
                  className="btn-ghost small"
                  disabled={submitting}
                  onClick={() => confirmWithBook(bookSuggestion.typed)}
                >
                  Keep &ldquo;{bookSuggestion.typed}&rdquo;
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={submitting}
                  onClick={() => setBookSuggestion(null)}
                >
                  dismiss
                </button>
              </div>
            </div>
          )}

          <div className="capture-foot">
            <div className="status-line">
              {submitting && (
                <span className="working">
                  <span className="spinner" aria-hidden />
                  <span>{phase}</span>
                  <span className="progress"><span style={{ width: progress + "%" }} /></span>
                </span>
              )}
              {!submitting && status && <span className="success">✓ {status}</span>}
              {!submitting && error && <span className="error">✕ {error}</span>}
              {!submitting && !status && !error && (
                <span className="hint-line">
                  {mode === "book"
                    ? "Passages are appended to the book's running note."
                    : mode === "video"
                    ? "Transcript fetched, key points distilled."
                    : mode === "link"
                    ? "Fetch, distill, tag. Filed under notes/articles."
                    : "Standalone thought — no external fetch."}
                </span>
              )}
            </div>
            <button type="submit" disabled={!canSubmit || submitting} className="btn-primary">
              <span>
                {submitting
                  ? "Capturing"
                  : mode === "book"
                  ? "File passage"
                  : mode === "video"
                  ? "Capture video"
                  : mode === "link"
                  ? "Capture link"
                  : "Capture note"}
              </span>
              <span className="arrow">→</span>
            </button>
          </div>
        </form>
      </section>

      {/* entries */}
      <section className="entries">
        <div className="entries-head">
          <div className="capture-label">
            <span className="num">02</span>
            <span>Today&rsquo;s specimens</span>
            <span className="sub">
              {loadingEntries
                ? "— loading…"
                : `— ${entries.length} filed since sunrise`}
            </span>
          </div>
          <div className="entries-actions">
            {selectMode && selectedIds.size > 0 && (
              <button
                className="btn-danger small"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Discarding…" : `Discard ${selectedIds.size}`}
              </button>
            )}
            {entries.length > 0 && (
              <button className="btn-ghost small" onClick={toggleSelectMode}>
                {selectMode ? "cancel" : "select"}
              </button>
            )}
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph">✱</div>
            <div>No specimens yet today.</div>
            <div className="sub">Paste something worth remembering above.</div>
          </div>
        ) : (
          <ol className="entry-list">
            {entries.map((entry, idx) =>
              renderEntry(entry, String(entries.length - idx).padStart(2, "0"))
            )}
          </ol>
        )}
      </section>

      <section className="entries">
        <div className="entries-head">
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => void toggleRecent()}
            disabled={recentLoading}
          >
            {recentLoading
              ? "loading…"
              : recentExpanded
                ? "hide last 30 days ↑"
                : "show last 30 days ↓"}
          </button>
        </div>
        {recentExpanded && (
          recentByDay.length === 0 ? (
            <div className="empty">
              <div className="sub">No entries in the last 30 days outside of today.</div>
            </div>
          ) : (
            <div className="recent-days">
              {recentByDay.map(({ day, list }) => (
                <div key={day} className="recent-day">
                  <h4 className="recent-day-head">{formatDayHeader(day)}</h4>
                  <ol className="entry-list">
                    {list.map((entry, idx) =>
                      renderEntry(
                        entry,
                        String(list.length - idx).padStart(2, "0")
                      )
                    )}
                  </ol>
                </div>
              ))}
            </div>
          )
        )}
      </section>

      <footer className="colophon">
        <div className="col-rule" aria-hidden />
        <div className="col-inner">
          <span>Mycelium — a personal knowledge capture</span>
          <span>entries indexed under ~/notes</span>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------- helpers ----------------------------- */

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="stat">
      <div className="stat-k">{label}</div>
      <div className="stat-v">
        <span className="num">{value}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
function clockTime(iso: string) {
  return new Date(iso)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Los_Angeles",
    })
    .toLowerCase();
}
function relTime(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function domainOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function pacificDateKey(iso: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(iso));
}

function formatDayHeader(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/* --------------------------- background ---------------------------- */

function MyceliumThreads({ seed = 7 }: { seed?: number }) {
  const paths = useMemo(() => {
    const rand = mulberry32(seed);
    const out: string[] = [];
    const W = 1600;
    const H = 1200;
    for (let i = 0; i < 14; i++) {
      let x = rand() * W;
      let y = rand() * H;
      let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const steps = 18 + Math.floor(rand() * 14);
      let angle = rand() * Math.PI * 2;
      for (let s = 0; s < steps; s++) {
        angle += (rand() - 0.5) * 0.9;
        const len = 22 + rand() * 40;
        const cx = x + Math.cos(angle) * len * 0.5;
        const cy = y + Math.sin(angle) * len * 0.5;
        x += Math.cos(angle) * len;
        y += Math.sin(angle) * len;
        d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      out.push(d);
    }
    return out;
  }, [seed]);
  return (
    <svg
      className="myc-threads"
      viewBox="0 0 1600 1200"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.6}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------- icons ------------------------------- */

const Logomark = () => (
  <svg viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="3.2" fill="currentColor" />
    <path d="M20 17 Q12 12 8 6" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    <path d="M20 17 Q28 12 34 6" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    <path d="M20 23 Q14 28 10 34" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    <path d="M20 23 Q26 28 32 34" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    <path d="M17 20 Q10 20 5 18" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    <path d="M23 20 Q30 20 36 18" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    <circle cx="8" cy="6" r="1.2" fill="currentColor" />
    <circle cx="34" cy="6" r="1.2" fill="currentColor" />
    <circle cx="10" cy="34" r="1.2" fill="currentColor" />
    <circle cx="32" cy="34" r="1.2" fill="currentColor" />
    <circle cx="5" cy="18" r="1.2" fill="currentColor" />
    <circle cx="36" cy="18" r="1.2" fill="currentColor" />
  </svg>
);
const IconLink = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  </svg>
);
const IconVideo = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="6" width="14" height="12" rx="1.5" />
    <path d="M17 10.5 L21 8 L21 16 L17 13.5 Z" />
  </svg>
);
const IconBook = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5 C4 4 5 3.5 6.5 3.5 H11 V19.5 H6.5 C5 19.5 4 20 4 21 Z" />
    <path d="M20 5 C20 4 19 3.5 17.5 3.5 H13 V19.5 H17.5 C19 19.5 20 20 20 21 Z" />
  </svg>
);
const IconNote = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3 H6 C5 3 4 4 4 5 V19 C4 20 5 21 6 21 H18 C19 21 20 20 20 19 V9 Z" />
    <path d="M14 3 V9 H20" />
    <path d="M8 13 H14" />
    <path d="M8 17 H16" />
  </svg>
);
const IconQuote = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 7 C4 7 3 9 3 11 V15 H7 V11 H5 C5 9 5.5 8.5 7 8" />
    <path d="M15 7 C13 7 12 9 12 11 V15 H16 V11 H14 C14 9 14.5 8.5 16 8" />
  </svg>
);
