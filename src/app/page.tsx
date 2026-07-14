import Link from "next/link";

const STEPS = [
  {
    title: "Word dump",
    body: "Describe what your kid did today, in your own words — a game, a book, a family project, an afternoon that had nothing to do with a curriculum.",
  },
  {
    title: "Translate",
    body: "FreeLoom classifies the activity, finds the closest thing it's seen before, and drafts a formally-worded class entry with its reasoning shown alongside it.",
  },
  {
    title: "Review",
    body: "Accept the draft, edit it, or write it yourself if nothing quite fits yet — every one of those choices makes the next draft better.",
  },
  {
    title: "Export, if you need to",
    body: "Generate a clean, branded transcript from the portfolio whenever an evaluator or program actually asks for one.",
  },
];

const FEATURES = [
  {
    title: "Show-your-work reasoning",
    body: "Every class entry comes with a plain-language explanation of why that activity counts — nothing is a black box, especially for parents who don't take AI-generated claims on faith.",
  },
  {
    title: "No neural model in the loop",
    body: "Classification, matching, and drafting are handled by classical rules and statistics, not a hosted language model — transparent by construction, not just by promise.",
  },
  {
    title: "Portfolio, organized by class",
    body: "Every child's record reads as a list of classes, each holding the entries that built up to it — not a folder of loose files.",
  },
  {
    title: "Brandable transcripts",
    body: "Your logo, your color, your homeschool's name — the transcript looks like it came from your family, not a template.",
  },
  {
    title: "Multi-child profiles",
    body: "One parent account. A separate portfolio and transcript for every child, fully isolated from each other.",
  },
  {
    title: "Grows with real use",
    body: "Every entry a parent accepts, edits, or writes from scratch feeds back into the system — the drafts get better the more a family actually uses it.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-24">
      <section className="text-center flex flex-col items-center gap-6 py-12">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-gold to-violet text-white text-2xl font-bold shadow-sm">
          F
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
          A record-keeper first, a transcript generator second
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">FREELOOM</h1>
        <p className="text-lg text-gold">Real learning, formally recorded.</p>
        <p className="max-w-2xl text-muted text-base leading-relaxed">
          Built for unschooling and wildschooling families: log the informal, unstructured, real
          stuff your kids actually do, and FreeLoom turns it into a structured class entry with
          its reasoning shown right alongside it — so you can see exactly why, not just trust that
          it&apos;s right. A transcript is something you generate from that record when you need one,
          not the thing you&apos;re stuck maintaining every day.
        </p>
        <div className="flex flex-wrap justify-center gap-4 mt-2">
          <Link
            href="/login"
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-white shadow-sm hover:bg-gold-hover transition-colors"
          >
            Get Started
          </Link>
          <a
            href="#how-it-works"
            className="rounded-md border border-border bg-surface px-5 py-2.5 font-medium text-foreground shadow-sm hover:bg-surface-hover transition-colors"
          >
            See how it works
          </a>
        </div>
      </section>

      <section id="how-it-works" className="flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">How it works</h2>
          <p className="text-muted text-sm max-w-xl mx-auto">
            Four steps from a word dump to a record worth keeping.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <div key={step.title} className="rounded-lg border border-border bg-surface shadow-sm p-6">
              <div className="text-sm text-gold font-mono mb-2">Step {i + 1}</div>
              <h3 className="font-semibold text-lg mb-1">{step.title}</h3>
              <p className="text-muted text-sm leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Built for families who want to see the work</h2>
          <p className="text-muted text-sm max-w-xl mx-auto">
            Not adapted from a generic school SIS, and not asking you to trust an AI you can&apos;t see inside of.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-surface shadow-sm p-6">
              <h3 className="font-semibold text-lg mb-1">{f.title}</h3>
              <p className="text-muted text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="text-center flex flex-col items-center gap-4 rounded-xl border border-border bg-surface shadow-sm p-10">
        <h2 className="text-2xl font-bold">Ready to see what your kids have actually been learning?</h2>
        <p className="text-muted text-sm max-w-lg">
          Create your parent account and add your first child in under two minutes.
        </p>
        <Link
          href="/login"
          className="rounded-md bg-gold px-5 py-2.5 font-medium text-white shadow-sm hover:bg-gold-hover transition-colors"
        >
          Get Started
        </Link>
      </section>
    </div>
  );
}
