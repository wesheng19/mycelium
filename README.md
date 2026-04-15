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

## Status

Scaffold only. Ingest endpoint returns a stub. Next: wire up DeepSeek summarization and the GitHub vault commit path.
