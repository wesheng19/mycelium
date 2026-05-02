"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Entry = {
  id: string;
  title: string;
  source: string;
  url: string | null;
  tldr: string | null;
  tags: string[] | null;
  markdownPath: string | null;
  createdAt: string;
  rank: number;
};

type TagCount = { tag: string; count: number };

const THEME_KEY = "mycelium.theme";

const SOURCE_META: Record<string, { glyph: string; label: string }> = {
  book: { glyph: "❦", label: "Book" },
  article: { glyph: "§", label: "Article" },
  youtube: { glyph: "▶", label: "Video" },
  text: { glyph: "✱", label: "Note" },
  note: { glyph: "✱", label: "Note" },
};

const SOURCE_PILLS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "article", label: "Articles" },
  { value: "youtube", label: "Videos" },
  { value: "book", label: "Books" },
  { value: "text", label: "Notes" },
];

const TAG_PREVIEW_COUNT = 24;

export default function ArchivePage() {
  const [theme, setTheme] = useState<"paper" | "ink">("paper");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [tagsList, setTagsList] = useState<TagCount[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = window.localStorage.getItem(THEME_KEY);
    if (t === "ink" || t === "paper") setTheme(t);
  }, []);

  useEffect(() => {
    fetch("/api/learnings/tags", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tags?: TagCount[] }) => setTagsList(d.tags ?? []))
      .catch(() => {});
  }, []);

  // Debounced refetch on any filter change. Initial mount fires too — that's
  // the "browse the archive" landing state.
  useEffect(() => {
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (tag) params.set("tag", tag);
          if (source) params.set("source", source);
          if (from) params.set("from", from);
          if (to) params.set("to", to);
          const res = await fetch(`/api/learnings/search?${params}`, {
            cache: "no-store",
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error(`Search failed: ${res.status}`);
          const data = (await res.json()) as {
            entries: Entry[];
            truncated: boolean;
          };
          setEntries(data.entries);
          setTruncated(data.truncated);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
          if (!ctrl.signal.aborted) setLoading(false);
        }
      })();
    }, 260);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [q, tag, source, from, to]);

  function clearFilters() {
    setQ("");
    setTag("");
    setSource("");
    setFrom("");
    setTo("");
  }

  const hasFilters = !!(q || tag || source || from || to);

  const grouped = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const day = pacificDateKey(e.createdAt);
      const list = groups.get(day);
      if (list) list.push(e);
      else groups.set(day, [e]);
    }
    return Array.from(groups, ([day, list]) => ({ day, list }));
  }, [entries]);

  const visibleTags = showAllTags ? tagsList : tagsList.slice(0, TAG_PREVIEW_COUNT);

  return (
    <div
      className={`shell ${theme === "ink" ? "theme-ink" : "theme-paper"} density-airy`}
      data-theme={theme}
    >
      <div className="grain" aria-hidden />

      <header className="masthead">
        <div className="mast-left">
          <div>
            <h1 className="wordmark" style={{ fontSize: "clamp(44px,7vw,76px)" }}>
              Archive
            </h1>
            <div className="tagline">Everything you&rsquo;ve filed</div>
          </div>
        </div>
        <div className="mast-right">
          <Link href="/" className="ghost-btn" style={{ textDecoration: "none" }}>
            home
          </Link>
        </div>
      </header>

      <div className="double-rule" aria-hidden>
        <span />
        <span />
      </div>

      <section className="capture-form" style={{ padding: 22, marginBottom: 32 }}>
        <div className="capture-label" style={{ marginBottom: 14 }}>
          <span className="num">⌕</span>
          <span>Search</span>
          <span className="sub">— word, phrase, &ldquo;exact match&rdquo;, -exclude</span>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="type to search…"
          autoFocus
          spellCheck={false}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: 0,
            fontFamily: "var(--serif)",
            fontSize: 22,
            color: "var(--ink)",
            fontStyle: "italic",
          }}
        />

        <div
          style={{
            marginTop: 18,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          {SOURCE_PILLS.map((p) => {
            const on = source === p.value;
            return (
              <button
                key={p.value || "all"}
                type="button"
                className="btn-ghost small"
                style={
                  on
                    ? {
                        color: "var(--accent)",
                        borderColor: "var(--accent)",
                        background: "var(--accent-soft)",
                      }
                    : {}
                }
                onClick={() => setSource(p.value)}
              >
                {p.label}
              </button>
            );
          })}

          <span style={{ flex: 1 }} />

          <label style={dateLabelStyle}>
            from
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={dateInputStyle}
            />
          </label>
          <label style={dateLabelStyle}>
            to
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={dateInputStyle}
            />
          </label>

          {hasFilters && (
            <button type="button" className="link-btn" onClick={clearFilters}>
              clear
            </button>
          )}
        </div>

        {tagsList.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="meta-k" style={{ marginBottom: 8 }}>
              tags
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {visibleTags.map((t) => {
                const on = tag === t.tag;
                return (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => setTag(on ? "" : t.tag)}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: on ? "var(--accent)" : "var(--ink-3)",
                      background: on ? "var(--accent-soft)" : "transparent",
                      border: `1px dotted ${on ? "var(--accent)" : "var(--paper-edge)"}`,
                      borderRadius: 2,
                      padding: "2px 8px",
                      cursor: "pointer",
                      letterSpacing: "0.03em",
                    }}
                  >
                    #{t.tag}
                    <span style={{ color: "var(--ink-4)", marginLeft: 5 }}>{t.count}</span>
                  </button>
                );
              })}
              {tagsList.length > TAG_PREVIEW_COUNT && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setShowAllTags((v) => !v)}
                >
                  {showAllTags ? "fewer" : `all ${tagsList.length}`}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="entries">
        <div className="entries-head">
          <div className="capture-label">
            <span className="num">∎</span>
            <span>Results</span>
            <span className="sub">
              {loading
                ? "— searching…"
                : `— ${entries.length} ${entries.length === 1 ? "entry" : "entries"}${truncated ? " (first 500)" : ""}`}
            </span>
          </div>
        </div>

        {error && (
          <div
            className="error"
            style={{ fontFamily: "var(--mono)", fontSize: 12, padding: "16px 0" }}
          >
            ✕ {error}
          </div>
        )}

        {!error && !loading && entries.length === 0 && (
          <div className="empty">
            <div className="empty-glyph">∅</div>
            <div>No entries match.</div>
            <div className="sub">
              {hasFilters
                ? "Try loosening the filters."
                : "Capture something on the home page first."}
            </div>
          </div>
        )}

        <div className="recent-days">
          {grouped.map(({ day, list }) => (
            <div key={day} className="recent-day">
              <h4 className="recent-day-head">{formatDayHeader(day)}</h4>
              <ol className="entry-list">
                {list.map((entry, idx) => {
                  const isOpen = expanded === entry.id;
                  const meta = SOURCE_META[entry.source] || SOURCE_META.note;
                  return (
                    <li
                      key={entry.id}
                      className={`entry ${isOpen ? "open" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                      onKeyDown={(e) => {
                        // Inner tag buttons share the keydown bubble path; only
                        // toggle when the row itself is the focused element.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpanded(isOpen ? null : entry.id);
                        }
                      }}
                    >
                      <div className="entry-index">
                        <span className="idx-num">
                          {String(list.length - idx).padStart(2, "0")}
                        </span>
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
                          </div>
                        </div>
                        <h3 className="entry-title">{entry.title}</h3>
                        {entry.tldr && <p className="entry-tldr">{entry.tldr}</p>}
                        {entry.tags && entry.tags.length > 0 && (
                          <div className="entry-tags">
                            {entry.tags.map((t) => (
                              <button
                                key={t}
                                type="button"
                                className="tag"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTag(tag === t ? "" : t);
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  borderBottom: "1px dotted var(--paper-edge)",
                                  padding: "2px 0",
                                  cursor: "pointer",
                                  font: "inherit",
                                }}
                              >
                                #{t}
                              </button>
                            ))}
                          </div>
                        )}
                        {isOpen && (
                          <div
                            className="entry-expand"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                })}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const dateLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--ink-3)",
};

const dateInputStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  background: "transparent",
  border: "1px solid var(--paper-edge)",
  borderRadius: 2,
  padding: "3px 6px",
  color: "var(--ink-2)",
};

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
    year: "numeric",
  });
}
