"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const SECRET_KEY = "mycelium.ingestSecret";
const THEME_KEY = "mycelium.theme";

export default function SetupPage() {
  const [theme, setTheme] = useState<"paper" | "ink">("paper");
  const [origin, setOrigin] = useState<string>("");
  const [secretSet, setSecretSet] = useState(false);
  const pageBmlRef = useRef<HTMLAnchorElement>(null);
  const selBmlRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const t = window.localStorage.getItem(THEME_KEY);
    if (t === "ink" || t === "paper") setTheme(t);
    setOrigin(window.location.origin);
    setSecretSet(!!window.localStorage.getItem(SECRET_KEY));
  }, []);

  useEffect(() => {
    if (!origin) return;
    // The trailing `void 0;` is the standard bookmarklet idiom — it ensures
    // the function's return value doesn't replace the host page when run.
    const pageBml =
      `javascript:(function(){window.open('${origin}/capture?url='+encodeURIComponent(location.href),'_blank');})();void 0;`;
    const selBml =
      `javascript:(function(){var s=getSelection().toString();if(!s){alert('Select text first');return;}window.open('${origin}/capture?text='+encodeURIComponent(s),'_blank');})();void 0;`;
    pageBmlRef.current?.setAttribute("href", pageBml);
    selBmlRef.current?.setAttribute("href", selBml);
  }, [origin]);

  function setSecret() {
    const v = window.prompt("INGEST_SECRET (stored locally, sent only to /api/ingest):");
    if (v) {
      window.localStorage.setItem(SECRET_KEY, v);
      setSecretSet(true);
    }
  }

  function resetSecret() {
    window.localStorage.removeItem(SECRET_KEY);
    setSecretSet(false);
  }

  const ingestUrl = origin ? `${origin}/api/ingest` : "/api/ingest";

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
              Setup
            </h1>
            <div className="tagline">Quick capture from anywhere</div>
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

      {/* Bookmarklet */}
      <section style={{ marginBottom: 56 }}>
        <div className="capture-label">
          <span className="num">01</span>
          <span>Browser bookmarklet</span>
          <span className="sub">— drag to your bookmarks bar</span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            margin: "14px 0 18px",
          }}
        >
          <a
            ref={pageBmlRef}
            href="#"
            className="btn-primary"
            onClick={(e) => e.preventDefault()}
            draggable
            title="Drag to bookmarks bar"
            style={{ textDecoration: "none" }}
          >
            <span>＋ Capture page</span>
            <span className="arrow">→</span>
          </a>
          <a
            ref={selBmlRef}
            href="#"
            className="btn-primary"
            onClick={(e) => e.preventDefault()}
            draggable
            title="Drag to bookmarks bar"
            style={{ textDecoration: "none" }}
          >
            <span>＋ Capture selection</span>
            <span className="arrow">→</span>
          </a>
        </div>
        <p style={proseStyle}>
          Drag each button onto your browser&rsquo;s bookmarks bar. Then, on any page worth keeping,
          click <strong>Capture page</strong> — a new tab opens, files the URL through
          DeepSeek + the vault, and closes itself. <strong>Capture selection</strong> sends only
          the highlighted text as a standalone note.
        </p>
        <p style={{ ...proseStyle, color: "var(--ink-3)", fontSize: 14 }}>
          The secret never leaves Mycelium&rsquo;s origin — the bookmarklet just opens the relay
          page, which reads it from this device&rsquo;s localStorage.
        </p>
      </section>

      {/* iOS Shortcut */}
      <section style={{ marginBottom: 56 }}>
        <div className="capture-label">
          <span className="num">02</span>
          <span>iOS Share Sheet</span>
          <span className="sub">— a one-tap Shortcut on iPhone</span>
        </div>
        <ol style={olStyle}>
          <li>
            Open the <strong>Shortcuts</strong> app, tap <strong>+</strong> to create a new
            shortcut.
          </li>
          <li>
            Tap <strong>Add Action</strong> → search <em>Get Contents of URL</em> → tap to add it.
          </li>
          <li>
            Set the <strong>URL</strong> field to{" "}
            <code style={codeStyle}>{ingestUrl}</code>.
          </li>
          <li>
            Tap the <strong>▾</strong> on the action to expand options. Set{" "}
            <strong>Method</strong> to <strong>POST</strong>.
          </li>
          <li>
            Add two <strong>Headers</strong>:
            <ul style={ulStyle}>
              <li>
                <code style={codeStyle}>Content-Type</code>:{" "}
                <code style={codeStyle}>application/json</code>
              </li>
              <li>
                <code style={codeStyle}>x-ingest-secret</code>:{" "}
                <em>your secret</em>
              </li>
            </ul>
          </li>
          <li>
            Set <strong>Request Body</strong> to <strong>JSON</strong>. Add a key{" "}
            <code style={codeStyle}>url</code> whose value is the magic variable{" "}
            <strong>Shortcut Input</strong> (tap the value field, then the variable picker).
          </li>
          <li>
            Tap the <strong>(i)</strong> info button at the bottom → name it{" "}
            <strong>Capture to Mycelium</strong> → toggle{" "}
            <strong>Show in Share Sheet</strong> on → set Share Sheet Types to{" "}
            <strong>URLs</strong> only.
          </li>
          <li>
            Save. From Safari, YouTube, Reader — tap <strong>Share</strong> →{" "}
            <strong>Capture to Mycelium</strong>. The Shortcut runs in the background; the entry
            lands in the home page within ~30 seconds.
          </li>
        </ol>
        <p style={{ ...proseStyle, color: "var(--ink-3)", fontSize: 14 }}>
          The secret lives only inside the Shortcut definition on your phone — it never syncs to
          another device unless you explicitly share the Shortcut.
        </p>
      </section>

      {/* Secret on this device */}
      <section>
        <div className="capture-label">
          <span className="num">03</span>
          <span>Secret on this device</span>
          <span className="sub">
            — stored in localStorage; sent only to <code style={codeStyle}>/api/ingest</code>
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 16,
              color: secretSet ? "var(--ink-2)" : "var(--ink-3)",
            }}
          >
            {secretSet ? "✓ secret is set" : "no secret set on this device"}
          </span>
          {secretSet ? (
            <button className="btn-ghost small" onClick={resetSecret}>
              reset
            </button>
          ) : (
            <button className="btn-ghost small" onClick={setSecret}>
              set secret
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  background: "var(--paper-2)",
  padding: "1px 6px",
  borderRadius: 2,
  color: "var(--ink-2)",
  wordBreak: "break-all",
};

const proseStyle: React.CSSProperties = {
  fontFamily: "var(--serif)",
  fontSize: 16,
  lineHeight: 1.65,
  color: "var(--ink-2)",
  maxWidth: "62ch",
  margin: "10px 0",
};

const olStyle: React.CSSProperties = {
  fontFamily: "var(--serif)",
  fontSize: 16,
  lineHeight: 1.7,
  color: "var(--ink-2)",
  maxWidth: "62ch",
  paddingLeft: 22,
};

const ulStyle: React.CSSProperties = {
  marginTop: 6,
  marginBottom: 6,
  paddingLeft: 22,
};
