# Mycelium

Personal knowledge capture system. Ingest a URL (article or YouTube video) or plain text, get a structured summary via LLM, and store it as a markdown note in a GitHub vault repo with metadata in PostgreSQL.

## Tech Stack

- **Framework**: Next.js 15 (App Router) on Vercel
- **Database**: PostgreSQL on Neon (`@neondatabase/serverless`) with Drizzle ORM
- **LLM**: DeepSeek Chat API (via OpenAI-compatible client)
- **Vault**: GitHub repo (`wesheng19/mycelium-vault`) via Octokit — markdown notes committed directly
- **Content extraction**: `@mozilla/readability` + `jsdom` for articles, `youtubei.js` (Innertube) for YouTube transcripts with Modal/AssemblyAI as a documented but currently-unused fallback
- **Language**: TypeScript 5.7, React 19

## Project Structure

```
src/
  app/
    page.tsx                     # Home page — input form + today's entries (client component)
    layout.tsx                   # Root layout
    api/
      ingest/route.ts            # POST /api/ingest — main pipeline (extract → summarize → store)
      learnings/
        today/route.ts           # GET — today's entries (Pacific Time boundaries)
        route.ts                 # DELETE — multi-select delete by IDs
  lib/
    db.ts                        # Drizzle schema + Neon client. Table: `learnings`
    vault.ts                     # commitNote() — push markdown to GitHub vault
    deepseek.ts                  # LLM summarization (title, tldr, takeaways, tags, whyItMatters)
    markdown.ts                  # Markdown + YAML frontmatter generation, date parts in Pacific Time
    tz.ts                        # pacificStartOfDay() — DST-aware Pacific midnight via Intl APIs
    ingest/
      article.ts                 # Fetch + Readability extraction
      youtube.ts                 # YouTube transcript extraction
      text.ts                    # Plain text passthrough
      errors.ts                  # IngestError class
```

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Run production server
npm run lint         # Lint
npm run db:generate  # Generate Drizzle migrations
npm run db:push      # Push schema to Neon
```

## Environment Variables

See `.env.local.example`. Required:

- `DATABASE_URL` — Neon PostgreSQL connection string
- `DEEPSEEK_API_KEY` — DeepSeek API key
- `GITHUB_TOKEN` — GitHub PAT with repo write access
- `VAULT_REPO` — GitHub repo path, e.g. `wesheng19/mycelium-vault`
- `INGEST_SECRET` — shared secret for `POST /api/ingest` (passed via `x-ingest-secret` header)

## Database Schema

Single table `learnings`:
- `id` (UUID, PK), `created_at` (timestamptz), `source` (text: article/youtube/text), `url` (text?), `title` (text), `tldr` (text?), `takeaways` (jsonb array?), `tags` (text[]?), `markdown_path` (text?)

## End-to-End Flow

1. User submits URL or text via the form (or directly via `POST /api/ingest`)
2. Content extracted (Readability for articles, transcript for YouTube, passthrough for text)
3. Truncated to 35k chars, sent to DeepSeek for structured summarization (chosen to keep the whole pipeline inside Vercel Hobby's 60s function cap)
4. Markdown note generated with YAML frontmatter (date, source, url, tags)
5. Committed to `wesheng19/mycelium-vault` on GitHub at path `YYYY/MM/YYYY-MM-DD-slug.md`
6. Metadata row inserted into PostgreSQL `learnings` table
7. Frontend fetches `GET /api/learnings/today` to display entries

## Timezone Handling

All "today" logic uses `America/Los_Angeles` (Pacific Time) with automatic DST handling via native `Intl` APIs. See `src/lib/tz.ts`. The database stores UTC timestamps; Pacific conversion happens at query/display time. Vault file paths and YAML frontmatter dates also use Pacific dates.

## API Authentication

`POST /api/ingest` and `DELETE /api/learnings` require header `x-ingest-secret` matching the `INGEST_SECRET` env var. `GET /api/learnings/today` is unauthenticated.

## Deployment

Deployed on Vercel from `main` branch. Database on Neon. Vault on GitHub. No local machine dependency — fully cloud-hosted. The ingest route sets `maxDuration = 60` for Vercel's serverless timeout.

## Active Branch

`claude/objective-snyder-42ab08` has unmerged work: multi-select delete feature + Pacific timezone fix. Merge to `main` to deploy.
