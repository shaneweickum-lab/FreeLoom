import Link from "next/link";

const STEPS = [
  {
    title: "Discover",
    body: "Describe your child's hobbies and how they learn. FreeLoom suggests subject and skill tracks tied to those interests as a starting point.",
  },
  {
    title: "Log",
    body: "Jot down activities in plain language — a game, a book, a family project, a platform like Recess.",
  },
  {
    title: "Translate",
    body: "The AI Translation Engine maps each activity to a formal course title, subject area, and credit estimate, grounded in a curated knowledge base.",
  },
  {
    title: "Export",
    body: "Generate a clean, evaluator-ready transcript with credits and GPA, attach portfolio work samples, and export as a PDF or shareable link.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-16">
      <section className="text-center flex flex-col items-center gap-6 py-12">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-gold to-violet text-background text-2xl font-bold">
          F
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">FREELOOM</h1>
        <p className="text-lg text-gold">Real learning, formally recorded.</p>
        <p className="max-w-2xl text-muted text-base leading-relaxed">
          We turn real-world and play-based learning into credible, structured transcripts and
          portfolios &mdash; using an engine that actually understands games, curricula, and
          unconventional teaching methods. No more translating what your kid actually learned
          into academic language by hand.
        </p>
        <div className="flex gap-4 mt-2">
          <Link
            href="/profile"
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-background hover:bg-gold-hover transition-colors"
          >
            Start Building
          </Link>
          <Link
            href="/transcript"
            className="rounded-md border border-border px-5 py-2.5 font-medium hover:bg-surface-hover transition-colors"
          >
            View Transcript
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <div key={step.title} className="rounded-lg border border-border bg-surface p-6">
            <div className="text-sm text-gold font-mono mb-2">Step {i + 1}</div>
            <h3 className="font-semibold text-lg mb-1">{step.title}</h3>
            <p className="text-muted text-sm leading-relaxed">{step.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
