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

function IconReasoning(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2.5" />
      <path d="M8 20l1.2-3.5" />
      <path d="M7.5 10l2.7 2.7L16.5 7.5" />
    </svg>
  );
}

function IconFolder(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function IconSeal(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="9" r="5" />
      <path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5" />
    </svg>
  );
}

function IconUsers(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="8" cy="9" r="3" />
      <path d="M3.5 19a4.5 5 0 0 1 9 0" />
      <circle cx="17" cy="8.5" r="2.5" />
      <path d="M13 19a4 4.2 0 0 1 8 0" />
    </svg>
  );
}

function IconTrendingUp(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M3 17l6-6 4 4 8-9" />
      <path d="M15 6h6v6" />
    </svg>
  );
}

const FEATURES = [
  {
    title: "Show-your-work reasoning",
    body: "Every class entry comes with a plain-language explanation of why that activity counts — nothing is a black box you're asked to take on faith.",
    icon: IconReasoning,
  },
  {
    title: "Portfolio, organized by class",
    body: "Every student's record reads as a list of classes, each holding the entries that built up to it — not a folder of loose files.",
    icon: IconFolder,
  },
  {
    title: "Brandable transcripts",
    body: "Your logo, your color, your homeschool's name — the transcript looks like it came from your family, not a template.",
    icon: IconSeal,
  },
  {
    title: "Multi-student profiles",
    body: "One parent account. A separate portfolio and transcript for every student, fully isolated from each other.",
    icon: IconUsers,
  },
  {
    title: "Grows with real use",
    body: "Every entry a parent accepts, edits, or writes from scratch feeds back into the system — the drafts get better the more a family actually uses it.",
    icon: IconTrendingUp,
  },
];

function GlowBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 -z-10 flex justify-center">
      <div className="h-[28rem] w-[90vw] max-w-[48rem] rounded-full bg-gradient-to-br from-gold/25 via-violet/15 to-transparent blur-3xl" />
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-24">
      <section className="relative text-center flex flex-col items-center gap-6 py-16">
        <GlowBackdrop />
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-gold to-violet text-white text-2xl font-bold shadow-md">
          F
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
          A record-keeper first, a transcript generator second
        </span>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">FREELOOM</h1>
        <p className="text-xl text-gold font-medium">Real learning, formally recorded.</p>
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
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-white shadow-sm hover:bg-gold-hover hover:shadow-md transition-all"
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
        <p className="text-xs text-muted">No credit card required — just a parent account and two minutes.</p>
      </section>

      <section className="flex flex-col gap-6">
        <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border bg-background px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <span className="ml-3 text-xs text-muted font-mono">freeloom.app/log</span>
          </div>
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">What you typed</div>
              <p className="text-sm leading-relaxed">
                &ldquo;Spent like 2 hours today building a redstone elevator in Minecraft. Kept
                debugging why it wouldn&apos;t reset right.&rdquo;
              </p>
            </div>
            <div className="p-6 bg-gold/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-gold mb-3">What FreeLoom drafted</div>
              <div className="text-sm font-semibold mb-1">Applied Digital Logic</div>
              <div className="text-xs text-muted mb-3">Computer Science · 0.5 credit hours</div>
              <p className="text-sm leading-relaxed text-foreground/85">
                Building redstone circuits means wiring functional logic gates and switching
                networks in-game, a hands-on introduction to boolean logic and digital circuit
                design.
              </p>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-muted">A real draft, from a real entry in FreeLoom&apos;s knowledge base.</p>
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
            <div
              key={step.title}
              className="relative rounded-lg border border-border bg-surface shadow-sm p-6 pl-8 transition-shadow hover:shadow-md"
            >
              <span className="absolute -left-4 top-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-gold text-white text-sm font-semibold shadow-sm">
                {i + 1}
              </span>
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
            Not adapted from a generic school SIS, and not asking you to trust something you can&apos;t see inside of.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-border bg-surface shadow-sm p-6 transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 text-gold mb-3">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="font-semibold text-lg mb-1">{f.title}</h3>
              <p className="text-muted text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative text-center flex flex-col items-center gap-4 rounded-xl bg-gradient-to-br from-gold to-violet p-10 shadow-lg overflow-hidden">
        <h2 className="text-2xl font-bold text-white">Ready to see what your kids have actually been learning?</h2>
        <p className="text-white/85 text-sm max-w-lg">
          Create your parent account and add your first student in under two minutes.
        </p>
        <Link
          href="/login"
          className="rounded-md bg-white px-5 py-2.5 font-medium text-gold-hover shadow-sm hover:bg-white/90 transition-colors"
        >
          Get Started
        </Link>
      </section>
    </div>
  );
}
