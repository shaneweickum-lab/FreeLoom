# FreeLoom

**Real learning, formally recorded.**

FreeLoom turns real-world and play-based homeschool learning — games, projects,
family activities — into credible, structured transcripts and portfolios for
evaluators, grant/ESA compliance, or college applications.

## MVP feature flow

1. **Sign up / sign in** (`/login`) — Supabase email/password auth.
2. **Student profiles** (`/dashboard`) — create one or more student profiles;
   switch the active student from the nav bar on any authenticated page.
3. **Student Profile & Discovery** (`/profile`) — describe a child's hobbies,
   personality, and learning style (`profile_notes`); get AI-suggested
   subject/skill tracks to accept or dismiss (`ai_suggested_tracks` jsonb).
4. **Learning Log Input** (`/log`) — describe an activity in plain language
   (`learning_logs`).
5. **AI Translation Engine** (`/api/translate-log`) — the core differentiator.
   Maps the activity to a formal course title, subject area, and a
   conservative credit-hour estimate (`translated_courses`, `status:
   suggested`). A local knowledge base (`src/lib/knowledgeBase.ts`) and
   keyword heuristic (`src/lib/translationEngine.ts`) ground well-known
   games/platforms (Factorio, Minecraft, poker, Recess, etc.) and act as the
   sole translation path when `ANTHROPIC_API_KEY` isn't set. When it is set,
   Claude does the actual translation — reasoning over both known activities
   and fully custom descriptions per the system prompt in
   `src/lib/translationPrompt.ts` — using the local match as a grounding hint
   rather than a hard constraint. The parent then **approves, edits, or
   rejects** the suggestion before it counts toward a transcript.
6. **Transcript Generator** (`/transcript`) — approved courses roll up into
   cumulative credit hours (no GPA — there's no grading input in this MVP).
   "Generate transcript" snapshots the current approved courses into a
   `transcripts` row; each snapshot is downloadable as a PDF and shareable via
   a public read-only link.
7. **Portfolio Builder** (`/portfolio`) — attach photos/files as work samples,
   optionally linked to a specific learning log entry.
8. **Share** (`/share/[transcriptId]`) — public, unauthenticated read-only
   view of a generated transcript, plus a PDF download link.

## Tech stack

- **Frontend/backend**: Next.js (App Router) + TypeScript + Tailwind CSS,
  deployed on Vercel.
- **Auth + database + storage**: Supabase (Postgres, email/password auth,
  Storage for portfolio files).
- **AI**: Anthropic API (Claude), called server-side only
  (`ANTHROPIC_API_KEY` is never exposed to the client).
- **PDF generation**: `@react-pdf/renderer`, rendered on demand in
  `/api/transcript-pdf/[transcriptId]`.

## Environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # Supabase publishable/anon key
ANTHROPIC_API_KEY=                  # optional — heuristic-only translation without it
```

See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` is intentionally **not**
required — every operation (including the public share view) runs through
Postgres Row Level Security plus one `SECURITY DEFINER` function
(`get_shared_transcript`) rather than a service-role bypass.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data model & security

Schema lives entirely in Supabase migrations (students, profile_notes,
learning_logs, translated_courses, portfolio_items, transcripts). Every table
has Row Level Security scoped to the owning `auth.uid()` through a join back
to `students.user_id`. Two storage buckets: `portfolio` (private, per-student
RLS) and `transcripts` (public bucket, flat `{transcriptId}.pdf` paths —
public only because the transcript id itself is the unguessable capability,
the same trust model as a signed link). The one public read path —
`/share/[transcriptId]` — goes through `get_shared_transcript(uuid)`, a
`SECURITY DEFINER` Postgres function granted to `anon`, so anonymous visitors
never need direct table access or a service-role key.

## Project structure

```
src/lib/types.ts                Core data model, mirrors the Postgres schema
src/lib/supabase/               Browser/server Supabase client factories + proxy session refresh
src/lib/knowledgeBase.ts        Known games/platforms -> course, subject, skills, credit (grounding hint)
src/lib/discoveryMap.ts         Hobby/interest -> suggested subject tracks (heuristic fallback)
src/lib/translationEngine.ts    Heuristic/knowledge-base translation, used standalone or as an AI grounding hint
src/lib/translationPrompt.ts    AI Translation Engine system prompt + tool schema
src/lib/discoveryPrompt.ts      Discovery-layer system prompt + tool schema
src/lib/studentContext.tsx      Client context: active student selection across pages
src/lib/TranscriptDocument.tsx  @react-pdf/renderer document definition
src/proxy.ts                    Next.js 16 Proxy (formerly "middleware"): session refresh + route protection
src/app/(app)/*                 Authenticated pages: dashboard, profile, log, transcript, portfolio
src/app/login/                  Sign in / sign up
src/app/share/[transcriptId]/   Public read-only transcript view
src/app/api/translate-log/      AI Translation Engine endpoint
src/app/api/suggest-tracks/     Discovery-layer suggestion endpoint
src/app/api/transcript-pdf/     On-demand PDF rendering (works for both owner and public share downloads)
```

## Out of scope for this MVP

Multi-student *household* sharing beyond one parent account, custom grading
scales / GPA, standardized test score import, evaluator e-signature
workflows, and state-by-state compliance templates are deferred — see the
project spec for the full phased roadmap.
