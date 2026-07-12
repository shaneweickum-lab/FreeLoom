# FreeLoom

**Real learning, formally recorded.**

FreeLoom turns real-world and play-based homeschool learning — games, projects,
family activities — into credible, structured transcripts and portfolios for
evaluators, grant/ESA compliance, or college applications.

This is a clickable MVP prototype covering the core flow end-to-end with
client-side storage (no database yet):

1. **Student Profile & Discovery** (`/profile`) — describe a child's hobbies
   and learning style; get suggested subject/skill tracks to accept or dismiss.
2. **Learning Log Input** (`/log`) — describe an activity in plain language.
3. **AI Translation Engine** (`/api/translate`) — maps the activity to a
   formal course title, subject area, skills, and credit-hour estimate. A
   curated knowledge base grounds well-known games/platforms (Factorio,
   Minecraft, poker, Recess, etc. — see `src/lib/knowledgeBase.ts`); a
   keyword-cluster heuristic (`src/lib/translationEngine.ts`) handles
   unlisted activities. If `ANTHROPIC_API_KEY` is set, Claude polishes the
   course title and rationale wording without being allowed to change the
   grounded subject, skills, or credit estimate.
4. **Transcript Generator** (`/transcript`) — accepted courses roll up into
   credit hours and a GPA, exportable as a PDF or a shareable read-only link.
5. **Portfolio Builder** (`/portfolio`) — attach photos/notes as work samples,
   optionally linked to a course.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Data is persisted to the browser's `localStorage` (see `src/lib/store.tsx`) —
there's no backend database in this prototype yet.

### Optional: AI-refined translations

Without an API key, the translation engine runs entirely on the local
knowledge base + heuristics. To let Claude polish course titles and
rationale text, set:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

## Tech stack

Next.js (App Router) + TypeScript + Tailwind CSS, `jspdf`/`jspdf-autotable`
for PDF export, `@anthropic-ai/sdk` for optional AI refinement.

## Project structure

```
src/lib/types.ts             Core data model (student, log entries, courses, portfolio)
src/lib/knowledgeBase.ts      Known games/platforms -> course, subject, skills, credit
src/lib/discoveryMap.ts       Hobby/interest -> suggested subject tracks
src/lib/translationEngine.ts  Heuristic fallback translation + credit-hour estimation
src/lib/store.tsx             localStorage-backed React context
src/lib/gpa.ts, share.ts, pdf.ts   GPA math, share-link encoding, PDF generation
src/app/*                     Pages for each MVP feature
src/app/api/translate/route.ts  Server route: grounded translation + optional Claude refinement
```

## Out of scope for this MVP

Multi-student accounts, custom grading scales, standardized test import,
evaluator e-signature workflows, state-by-state compliance templates, and
persistence beyond `localStorage` are deferred — see the project spec for
the full phased roadmap.
