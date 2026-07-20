# FreeLoom

**Real learning, formally recorded.**

FreeLoom turns real-world and play-based learning — games, projects, family
activities — into credible, structured transcripts and portfolios for
evaluators, grant/ESA compliance, or college applications. It's built for
homeschooling, unschooling, and wildschooling families: anyone teaching
outside a conventional classroom who still needs a record that reads as
formal when something official asks for one.

## Status

Pre-launch. The landing page (`/`) is public with a waitlist signup; the app
itself (`/dashboard` and everything under it) is live for provisioned
accounts. Currently **v0.5.6** — see the About section in Settings for a
running list of what's shipped.

## Feature tour

### For parents

- **Multi-student accounts** (`/dashboard`) — one login, a separate
  portfolio and transcript per student, fully isolated from each other.
- **Student Profile & Discovery** (`/profile`) — free-text notes on a
  child's hobbies and learning style; matched against a curated
  interest→subject lookup to suggest classes worth starting a log for.
- **Learning Log** (`/log`) — describe an activity in plain language and
  FreeLoom drafts a formal class entry with its reasoning shown alongside
  it, via a fully local, deterministic pipeline (no external AI API call
  anywhere in the request):
  1. **Classify** — a hand-curated knowledge base of well-known
     games/platforms, plus a keyword-cluster fallback.
  2. **Retrieve** — if the classify step only produced a generic guess,
     search the child's own accepted history for a similar past word dump
     (feature-hashed vector + cosine similarity via pgvector — no neural
     embedding model) and reuse what was accepted then.
  3. **Compose** — turn a bare subject guess into real prose by stitching
     together hand-authored fragments matched to the activity.
  4. **Confidence check** — if nothing above was confident enough, the
     parent resolves it by hand instead of accepting a weak guess.
  5. Every entry can carry more than one subject tag, each with its own
     credit value, confidence, and "why this mapping" reasoning the parent
     can edit, remove, or add to.
- **Portfolio** (`/portfolio`) — every accepted entry, organized by class,
  editable if something needs a second look.
- **Transcript** (`/transcript`) — accepted entries roll up into GPA
  (letter grades × credit hours, grouped by high-school grade level) and
  cumulative credit totals. Add a school name, parent name, logo, and
  accent color once, then generate a snapshot any time — each one is
  downloadable as a branded PDF and shareable via a public read-only link
  (`/share/[transcriptId]`).
- **Messages** (`/messages`) — a direct line to the FreeLoom team, split
  into named conversation threads (not one long, undifferentiated thread).
  Start a new thread, delete one entirely, or clear its messages. Replies
  show up instantly via Supabase Realtime, including a "someone's typing"
  indicator while the other side is composing.
- **Notifications** (bell in the nav rail, full inbox at `/notifications`)
  — replies, platform announcements, and account-access requests in one
  feed, live-updating with no refresh needed. Clear the bell, delete
  individual notifications, or mark everything read at once.
- **Settings** (`/settings`) — parent name, state, contact info, and
  whether the family homeschools, unschools, or wildschools (used to
  target announcements). Includes an About section listing shipped
  features and the current version number.

### For admins

Any account in the `admin_users` table can:

- See waitlist signups and approve/remove other admins (self-service — no
  hardcoded owner account).
- Browse a searchable **Families** directory (email + parent name +
  schooling type) and open a per-family page to message them directly,
  request read-only account access, or send a personalized announcement.
- Send **announcements** to everyone, one specific family, or every family
  of a given schooling type — each recipient sees it as a normal
  notification, not a blast email.
- Request **consent-gated, time-boxed read-only access** to a specific
  family's account to help debug an issue. The parent gets a notification
  with the reason and can approve or deny it; an approval auto-expires one
  hour later. While active, the admin sees a full read-only mirror of that
  family's own pages (Dashboard, Profile, Learning Log, Transcript,
  Portfolio, Settings) — every field visible and populated, nothing
  editable.

## Tech stack

- **Frontend/backend**: Next.js 16 (App Router, Turbopack) + TypeScript +
  Tailwind CSS v4, deployed on Vercel. Note: this fork renames
  `middleware.ts` to `proxy.ts` and has other breaking changes from
  mainline Next.js — see `node_modules/next/dist/docs/` before assuming
  familiar APIs still work the same way.
- **Auth + database + storage + realtime**: Supabase (Postgres, Row Level
  Security, email/password auth, Storage for branding/portfolio assets,
  Realtime for messages/notifications/typing indicators).
- **Transactional email**: Resend, for waitlist confirmation.
- **PDF generation**: `@react-pdf/renderer`, rendered on demand in
  `/api/transcript-pdf/[transcriptId]`.
- No external AI/model API is called anywhere in the request path today —
  the learning-log pipeline, discovery suggestions, and retrieval matching
  are all local, deterministic, and testable without a network call. See
  `ml/` for an experimental, separate on-device model training project
  (BitNet + LoRA) that nothing in production currently imports.

## Environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=       # Supabase publishable/anon key
SUPABASE_SERVICE_ROLE_KEY=           # server-only; see "Data model & security" below
RESEND_API_KEY=                      # waitlist confirmation email
```

See `.env.example`. `ANTHROPIC_API_KEY` still appears there but isn't read
by any current code path — nothing in this codebase makes an AI/model API
call today.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run lint    # eslint
npm test        # vitest run
npm run build   # production build + type-check
```

## Data model & security

Schema lives entirely in Supabase migrations (applied directly against the
project, not checked into this repo as SQL files). Every table is scoped by
Row Level Security to the owning `auth.uid()` — directly for account-level
tables (`students`, `school_profiles`), or via a join back to
`students.user_id` for everything student-scoped (`classes`, `entries`,
`entry_subject_tags`, `profile_notes`, `transcripts`).

Two deliberate, narrow escapes from that pattern, both `SECURITY DEFINER`
Postgres functions rather than a service-role bypass:

- **`get_shared_transcript(uuid)`** — grants anonymous visitors read access
  to exactly one transcript snapshot via `/share/[transcriptId]`, gated by
  the transcript id itself being the unguessable capability.
- **`admin_view_account(uuid)`** — re-checks `is_admin()` and a live,
  unexpired entry in `account_access_requests` on every call (no separate
  expiry cron needed) before returning a full read-only snapshot of a
  family's data.

Admin status itself runs through `is_admin(uuid)`, another `SECURITY
DEFINER` function, so every admin-gated RLS policy checks the same source
of truth instead of a hardcoded email. The one legitimate use of the
service-role client (`src/lib/supabase/admin.ts`) is enumerating or looking
up `auth.users` — something RLS structurally can't do — for the admin
roster and announcement fan-out; it never reads or writes application
tables on a non-admin's behalf.

The consent-gate for account access is enforced twice: RLS only lets the
*target parent* (`target_user_id = auth.uid()`) update their own
`account_access_requests` row, and a `BEFORE UPDATE` trigger
(`enforce_access_request_transition`) rejects any transition other than
`pending→approved/denied` or `approved→revoked`, computing `expires_at`
server-side regardless of what the client sends.

## Project structure

```
src/lib/types.ts                   Core data model, mirrors the Postgres schema
src/lib/supabase/                  Browser/server/service-role client factories + proxy session refresh
src/lib/adminAuth.ts               Shared requireAdmin() check for every admin API route
src/lib/appVersion.ts              Single source of truth for the version shown in Settings
src/lib/studentContext.tsx         Client context: active student, per-student stats, subject ledger
src/lib/useNotifications.ts        Shared fetch + Realtime subscription + mark-read/delete for the bell and inbox
src/lib/gpa.ts                     Letter-grade points, cumulative GPA, grade-level grouping
src/lib/pipeline/classify.ts       Stage 1: knowledge-base + keyword-cluster classification
src/lib/pipeline/retrieve.ts       Stage 2: similarity search over a student's own accepted history
src/lib/pipeline/compose.ts        Stage 3: fragment-based description/reasoning composition
src/lib/pipeline/vectorize.ts      Feature-hashing vectorization backing Stage 2 (no neural embedding)
src/lib/pipeline/credit-calculation.ts / ledger.ts   Integer-hundredths credit-summing (no float drift)
src/lib/knowledgeBase.ts           Known games/platforms -> course, subject, skills, credit
src/lib/discoveryMap.ts            Hobby/interest -> suggested subject tracks
src/lib/TranscriptDocument.tsx     @react-pdf/renderer document definition
src/lib/email/waitlistConfirmation.ts   Branded waitlist confirmation email template
src/proxy.ts                       Next.js 16 Proxy (formerly "middleware"): session refresh + route protection
src/app/(app)/*                    Authenticated pages: dashboard, profile, log, transcript, portfolio,
                                    messages, notifications, settings, admin
src/app/login/                     Sign in / sign up
src/app/share/[transcriptId]/      Public read-only transcript view
src/app/api/pipeline/classify/     Learning Log pipeline endpoint (stages 1-4)
src/app/api/suggest-tracks/        Discovery-layer suggestion endpoint
src/app/api/transcript-pdf/        On-demand PDF rendering (owner and public share downloads)
src/app/api/messages/              Thread messaging: send + mark-read
src/app/api/waitlist/              Waitlist signup + confirmation email
src/app/api/admin/*                Admin roster, announcements, access requests
src/app/api/access-requests/[id]/  Parent-side approve/deny/revoke
ml/                                 Separate Python subproject (BitNet + LoRA on-device model
                                    training) -- see ml/README.md; not imported by the app above
```

## Out of scope for now

Custom grading scales beyond letter-grade GPA, standardized test score
import, evaluator e-signature workflows, and state-by-state compliance
templates are deferred — see `docs/slm-strategy.md` for the longer-term
on-device-model direction referenced by `ml/`.
