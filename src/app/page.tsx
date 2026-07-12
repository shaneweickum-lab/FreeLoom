import Link from "next/link";
import { PLAN_LIMITS, PLAN_ORDER } from "@/lib/plans";

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
    body: "Generate a clean, evaluator-ready transcript with credit hours, attach portfolio work samples, and export as a PDF or shareable link.",
  },
];

const ASSISTANT_CAPABILITIES = [
  { icon: "📋", body: "Logs a new activity and drafts a course from a single sentence" },
  { icon: "✅", body: "Approves, edits, or rejects AI-suggested courses" },
  { icon: "✏️", body: "Updates your child's profile and discovery notes" },
  { icon: "💡", body: "Suggests new subject tracks from their interests" },
  { icon: "📄", body: "Generates a transcript and hands you a shareable link" },
];

const FEATURES = [
  {
    title: "Discovery Engine",
    body: "Turn hobbies and personality into subject and skill track suggestions before you've logged a single activity.",
  },
  {
    title: "AI Translation Engine",
    body: "Every activity is mapped to a formal course title, subject area, and credit estimate, grounded in a curated knowledge base.",
  },
  {
    title: "Agentic Assistant",
    body: "A conversational AI that doesn't just advise — it reads your child's real records and acts on them for you.",
  },
  {
    title: "Portfolio Builder",
    body: "Attach photos, writing, and work samples as evidence behind every course on the transcript.",
  },
  {
    title: "Multi-Child Profiles",
    body: "One parent account. A separate discovery log, transcript, and portfolio for every child.",
  },
  {
    title: "Shareable Transcripts",
    body: "Export a clean PDF or send evaluators a read-only link — no account required on their end.",
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
          ✨ An agentic AI platform, not just a form builder
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">FREELOOM</h1>
        <p className="text-lg text-gold">Real learning, formally recorded.</p>
        <p className="max-w-2xl text-muted text-base leading-relaxed">
          We turn real-world and play-based learning into credible, structured transcripts and
          portfolios — using an engine that actually understands games, curricula, and
          unconventional teaching methods. A built-in AI assistant does the paperwork with you,
          not just for you: it logs activities, approves courses, and builds transcripts inside
          one conversation. One parent account, a separate profile and transcript for every child.
        </p>
        <div className="flex flex-wrap justify-center gap-4 mt-2">
          <Link
            href="/login"
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-white shadow-sm hover:bg-gold-hover transition-colors"
          >
            Get Started
          </Link>
          <a
            href="#agentic-assistant"
            className="rounded-md border border-border bg-surface px-5 py-2.5 font-medium text-foreground shadow-sm hover:bg-surface-hover transition-colors"
          >
            See what the assistant can do
          </a>
        </div>
      </section>

      <section id="agentic-assistant" className="rounded-xl border border-border bg-surface shadow-sm p-8 sm:p-10 grid gap-8 sm:grid-cols-2 items-center">
        <div className="flex flex-col gap-3">
          <div className="text-sm text-gold font-mono">Agentic, by design</div>
          <h2 className="text-2xl font-bold">An assistant, not a chatbot</h2>
          <p className="text-muted text-sm leading-relaxed">
            Describe what your child did, in your own words, and FreeLoom&apos;s built-in AI assistant takes
            it from there — reading your child&apos;s actual profile, learning log, and courses, then acting
            on your behalf inside the same conversation. No forms to hunt for, no separate approval screen
            to remember to visit.
          </p>
          <p className="text-muted text-xs">
            Every action happens inside one conversation, scoped only to the child you&apos;re talking about.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {ASSISTANT_CAPABILITIES.map((c) => (
            <div key={c.body} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
              <span className="text-lg leading-none">{c.icon}</span>
              <p className="text-sm">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">How it works</h2>
          <p className="text-muted text-sm max-w-xl mx-auto">
            Four steps from a hobby to an evaluator-ready transcript.
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
          <h2 className="text-2xl font-bold mb-2">Everything a transcript needs</h2>
          <p className="text-muted text-sm max-w-xl mx-auto">
            Built specifically for homeschool families, not adapted from a generic school SIS.
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

      <section className="flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Simple, transparent pricing</h2>
          <p className="text-muted text-sm max-w-xl mx-auto">
            Start free with one child. Upgrade any time as your family — or your assistant usage — grows.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {PLAN_ORDER.map((planId) => {
            const plan = PLAN_LIMITS[planId];
            return (
              <div key={planId} className="rounded-lg border border-border bg-surface shadow-sm p-6 flex flex-col gap-3">
                <div>
                  <div className="font-semibold text-lg">{plan.label}</div>
                  <div className="text-2xl font-bold mt-1">
                    {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly.toFixed(2)}`}
                    {plan.priceMonthly > 0 && <span className="text-sm text-muted font-normal">/mo</span>}
                  </div>
                </div>
                <div className="text-sm text-muted">
                  {plan.maxChildren === null
                    ? "Unlimited children"
                    : `${plan.maxChildren} child${plan.maxChildren === 1 ? "" : "ren"}`}
                </div>
                <div className="text-sm text-muted">{plan.monthlyActions} AI actions / month</div>
                <Link href="/login" className="btn-secondary text-sm text-center mt-2">
                  Get Started
                </Link>
              </div>
            );
          })}
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
