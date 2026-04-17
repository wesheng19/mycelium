# Mycelium

A personal "second brain" — capture daily learnings from YouTube, articles, and notes; AI-summarize with DeepSeek; store as markdown in a separate vault repo that you clone into Obsidian.

## Stack

- TypeScript / Next.js (App Router) — backend + UI in one project
- Hosting: Vercel (Hobby tier)
- DB: Neon Postgres (pgvector later)
- LLM: DeepSeek (OpenAI-compatible)
- Markdown vault: separate GitHub repo, e.g. `wesheng19/mycelium-vault`

## Setup

```bash
npm install
cp .env.local.example .env.local
# fill in DEEPSEEK_API_KEY, DATABASE_URL, GITHUB_TOKEN, INGEST_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

| Var | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key (OpenAI-compatible) |
| `DATABASE_URL` | Neon Postgres connection string |
| `GITHUB_TOKEN` | PAT with `contents:write` on the vault repo |
| `VAULT_REPO` | `owner/repo` of the markdown vault, e.g. `wesheng19/mycelium-vault` |
| `INGEST_SECRET` | Shared secret for the ingest endpoint (used by phone shortcuts, etc.) |

## Vault concept

The app commits markdown files (Obsidian-compatible YAML frontmatter) to a separate GitHub repo — the **vault**. You clone that repo locally and open it in Obsidian. The app is the writer, Obsidian is the reader, GitHub is the source of truth.

```
---
date: 2026-04-13
source: youtube
url: https://...
tags: [ai, productivity]
---

# Title
## TL;DR
## Key Takeaways
## Why this matters
```

## Database migration

The Drizzle schema lives in `src/lib/db.ts`. To create / sync the `learnings` table on Neon:

```bash
npm run db:push
```

`drizzle.config.ts` loads `.env.local` itself, so no extra wrapper is needed. Use `npm run db:generate` if you'd rather produce a SQL migration file under `./drizzle` and apply it manually.

## Ingest API

`POST /api/ingest` — body `{url?: string, text?: string}`, requires header `x-ingest-secret: <INGEST_SECRET>`. Detects YouTube vs. article vs. raw text, summarizes with DeepSeek, commits a markdown note to the vault repo, and inserts a row into `learnings`.

`GET /api/learnings/today` — returns today's entries from the DB.

The web UI at `/` prompts for the ingest secret on first load and stores it in `localStorage`.

## Status

End-to-end ingest wired: source detection → DeepSeek summarize → vault commit → DB insert. Embeddings / search are deferred.
