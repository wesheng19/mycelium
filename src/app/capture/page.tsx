"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const SECRET_KEY = "mycelium.ingestSecret";
const THEME_KEY = "mycelium.theme";
const PHASES = ["Reading…", "Fetching…", "Distilling…", "Tagging…", "Filing…"];

type State =
  | { kind: "idle" }
  | { kind: "no-input" }
  | { kind: "no-secret" }
  | { kind: "submitting" }
  | { kind: "success"; path: string }
  | { kind: "error"; message: string };

type Target = { kind: "url" | "text"; value: string };

export default function CapturePage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [phase, setPhase] = useState<string>(PHASES[0]);
  const [progress, setProgress] = useState(0);
  const [theme, setTheme] = useState<"paper" | "ink">("paper");
  const [target, setTarget] = useState<Target | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (typeof window === "undefined") return;

    const storedTheme = window.localStorage.getItem(THEME_KEY);
    if (storedTheme === "ink" || storedTheme === "paper") setTheme(storedTheme);

    const params = new URLSearchParams(window.location.search);
    const url = params.get("url")?.trim();
    const text = params.get("text")?.trim();

    if (!url && !text) {
      setState({ kind: "no-input" });
      return;
    }

    const t: Target = url ? { kind: "url", value: url } : { kind: "text", value: text! };
    setTarget(t);

    let secret = window.localStorage.getItem(SECRET_KEY);
    if (!secret) {
      const entered = window.prompt("Enter INGEST_SECRET (saved on this device):");
      if (entered) {
        window.localStorage.setItem(SECRET_KEY, entered);
        secret = entered;
      }
    }
    if (!secret) {
      setState({ kind: "no-secret" });
      return;
    }

    const ingestSecret = secret;
    const payload: Record<string, string> =
      t.kind === "url" ? { url: t.value } : { text: t.value };

    setState({ kind: "submitting" });

    void (async () => {
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ingest-secret": ingestSecret,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          path?: string;
          needsBookConfirmation?: boolean;
        };
        if (!res.ok || !data.ok || !data.path) {
          throw new Error(data.error ?? `Request failed: ${res.status}`);
        }
        setProgress(100);
        setState({ kind: "success", path: data.path });
        window.setTimeout(() => {
          window.close();
        }, 1800);
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (state.kind !== "submitting") return;
    let p = 0;
    let i = 0;
    setPhase(PHASES[0]);
    const id = window.setInterval(() => {
      p = Math.min(92, p + Math.random() * 14);
      setProgress(p);
      i = Math.min(PHASES.length - 1, i + (Math.random() > 0.55 ? 1 : 0));
      setPhase(PHASES[i]);
    }, 500);
    return () => window.clearInterval(id);
  }, [state.kind]);

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
              Capturing
            </h1>
            <div className="tagline">A field journal entry, in transit</div>
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

      <section className="capture-form" style={{ padding: 22 }}>
        {state.kind === "idle" && (
          <div className="hint-line">Preparing…</div>
        )}

        {state.kind === "no-input" && (
          <>
            <div className="capture-label">
              <span className="num">!</span>
              <span>Nothing to capture</span>
            </div>
            <div className="hint-line" style={{ marginTop: 8 }}>
              Open this page with <code style={codeStyle}>?url=…</code> or{" "}
              <code style={codeStyle}>?text=…</code> in the query string, or use a bookmarklet
              from <Link href="/setup">Setup</Link>.
            </div>
          </>
        )}

        {state.kind === "no-secret" && (
          <>
            <div className="capture-label">
              <span className="num">!</span>
              <span>Missing secret</span>
            </div>
            <div className="hint-line" style={{ marginTop: 8 }}>
              No <code style={codeStyle}>INGEST_SECRET</code> on this device. Open the{" "}
              <Link href="/setup">Setup</Link> page to enter one, then try again.
            </div>
          </>
        )}

        {state.kind === "submitting" && target && (
          <>
            <div className="capture-label">
              <span className="num">→</span>
              <span>In transit</span>
              <span className="sub">— this can take 20–40 seconds</span>
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-3)",
                wordBreak: "break-all",
                margin: "10px 0 14px",
                lineHeight: 1.5,
              }}
            >
              {target.kind === "url"
                ? target.value
                : target.value.length > 160
                  ? `${target.value.slice(0, 160)}…`
                  : target.value}
            </div>
            <div className="status-line">
              <span className="working">
                <span className="spinner" aria-hidden />
                <span>{phase}</span>
                <span className="progress">
                  <span style={{ width: progress + "%" }} />
                </span>
              </span>
            </div>
            <div className="hint-line" style={{ marginTop: 16 }}>
              You can close this tab — the request will keep running.
            </div>
          </>
        )}

        {state.kind === "success" && (
          <>
            <div className="capture-label">
              <span className="num">✓</span>
              <span>Filed</span>
            </div>
            <div className="meta-v mono" style={{ marginTop: 8, wordBreak: "break-all" }}>
              {state.path}
            </div>
            <div className="hint-line" style={{ marginTop: 14 }}>
              Closing this tab…
            </div>
          </>
        )}

        {state.kind === "error" && (
          <>
            <div className="capture-label">
              <span className="num">✕</span>
              <span>Capture failed</span>
            </div>
            <div
              className="error"
              style={{
                margin: "10px 0 14px",
                fontFamily: "var(--mono)",
                fontSize: 12,
              }}
            >
              {state.message}
            </div>
            <Link
              href="/"
              className="btn-ghost small"
              style={{ textDecoration: "none", display: "inline-block" }}
            >
              open mycelium
            </Link>
          </>
        )}
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
};
