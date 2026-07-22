import Link from "next/link";
import ParallaxHero from "@/components/ParallaxHero";
import StitchDivider from "@/components/StitchDivider";
import { fetchPriceTable } from "@/lib/billing/prices";
import PricingSection from "@/components/PricingSection";
import CookiePreferencesButton from "@/components/CookiePreferencesButton";

// Render per-request rather than being statically prerendered at build time:
// the pricing section must always show live Stripe prices ("shadow Stripe"),
// never a build-time snapshot baked into static HTML.
export const dynamic = "force-dynamic";

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

function IconMessage(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function IconBell(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconChip(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M9.5 7V4M14.5 7V4M9.5 20v-3M14.5 20v-3M7 9.5H4M7 14.5H4M20 9.5h-3M20 14.5h-3" />
    </svg>
  );
}

function IconTarget(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

const FEATURES = [
  {
    title: "Show-your-work reasoning",
    body: "Every class entry comes with a plain-language explanation of why that activity counts.",
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
  {
    title: "A direct line to the team",
    body: "Message us straight from your account, organized into named conversations — not one long, messy thread.",
    icon: IconMessage,
  },
  {
    title: "Nothing waits for a refresh",
    body: "Replies and updates show up the instant they happen — no reloading the page to see if someone answered.",
    icon: IconBell,
  },
  {
    title: "Updates that match how you learn",
    body: "Tell us if your family homeschools, unschools, or wildschools, and we'll only send you the announcements that are actually relevant.",
    icon: IconTarget,
  },
  {
    title: "Benny, a sovereign SLM",
    body: "FreeLoom's built-in assistant runs on a small language model trained entirely in-house for this platform -- not a rented third-party API -- so your family's questions and data never have to leave FreeLoom to get an answer.",
    icon: IconChip,
  },
];

export default async function Home() {
  const prices = await fetchPriceTable();
  return (
    <div className="flex flex-col min-h-full">
      <ParallaxHero />

      {/* Full-bleed opaque background: the parallax hero's image is fixed
          behind the whole page, so everything below it needs to fully cover
          it edge-to-edge, not just within the centered max-w-5xl column. */}
      <div className="relative bg-background">
        <main className="mx-auto w-full max-w-5xl px-4 sm:px-6 flex flex-col gap-24 py-16 sm:py-24">
          <section className="flex flex-col gap-6">
          <div className="mx-auto w-full max-w-3xl rounded-xl border border-navy-line shadow-lg overflow-hidden flex flex-col sm:flex-row">
            <div className="p-6 bg-navy-soft sm:w-1/2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-3 font-mono">What you typed</div>
              <p className="text-sm leading-relaxed italic font-serif">
                &ldquo;Spent like 2 hours today building a redstone elevator in Minecraft. Kept
                debugging why it wouldn&apos;t reset right.&rdquo;
              </p>
            </div>
            <StitchDivider />
            <div className="p-6 bg-parchment text-ink sm:w-1/2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft mb-3 font-mono">What FreeLoom drafted</div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-sm font-semibold font-serif">Applied Digital Logic</div>
                <span className="rounded-full bg-gold/20 text-ink text-xs font-mono px-2 py-0.5 shrink-0">0.5 cr</span>
              </div>
              <div className="text-xs text-ink-soft mb-3">Computer Science</div>
              <p className="text-sm leading-relaxed text-ink/85">
                Building redstone circuits means wiring functional logic gates and switching
                networks in-game, a hands-on introduction to boolean logic and digital circuit
                design.
              </p>
            </div>
          </div>
          <p className="text-center text-xs text-muted">A real draft, from a real entry in FreeLoom&apos;s knowledge base.</p>
        </section>

        <section id="how-it-works" className="scroll-mt-24 flex flex-col gap-10">
          <div className="text-center">
            <h2 className="font-serif text-2xl font-bold mb-2">How it works</h2>
            <p className="text-muted text-sm max-w-xl mx-auto">
              Four steps from a word dump to a record worth keeping.
            </p>
          </div>
          <div className="grid gap-8 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="relative flex flex-col items-center text-center gap-3">
                {i < STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className="hidden lg:block absolute top-5 left-1/2 h-px"
                    style={{
                      width: "calc(100% + 2rem)", // 2rem matches this grid's gap-8, so the line reaches the next column's circle instead of stopping short at this column's edge
                      backgroundImage: "repeating-linear-gradient(90deg, var(--gold) 0 8px, transparent 8px 14px)",
                    }}
                  />
                )}
                <span className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gold text-ink text-sm font-semibold font-mono shadow-sm">
                  {i + 1}
                </span>
                <h3 className="font-semibold text-lg font-serif">{step.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="scroll-mt-24 flex flex-col gap-8">
          <div className="text-center">
            <h2 className="font-serif text-2xl font-bold mb-2">Built for families who want to see the work</h2>
            <p className="text-muted text-sm max-w-xl mx-auto">
              Not adapted from a generic school SIS, and not asking you to trust something you can&apos;t see inside of.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const violetTint = i % 2 === 1;
              return (
                <div
                  key={f.title}
                  className="rounded-lg border border-navy-line bg-navy-soft shadow-sm p-6 transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full mb-3 ${
                      violetTint ? "bg-violet/15 text-violet-soft" : "bg-gold/15 text-gold"
                    }`}
                  >
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="font-semibold text-lg mb-1 font-serif">{f.title}</h3>
                  <p className="text-muted text-sm leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        <PricingSection prices={prices} />

        <section className="relative rounded-xl border border-gold/30 bg-navy-soft p-10 shadow-lg overflow-hidden text-center flex flex-col items-center gap-4">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-gold/15 via-violet/10 to-transparent"
          />
          <h2 className="font-serif text-2xl font-bold">Ready to see what your kids have actually been learning?</h2>
          <p className="text-muted text-sm max-w-lg">
            Create your parent account and add your first student in under two minutes.
          </p>
          <Link
            href="/login"
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-ink shadow-sm hover:bg-gold-hover transition-colors"
          >
            Get Started
          </Link>
        </section>
        </main>

        <footer className="border-t border-navy-line">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 text-xs text-muted flex flex-wrap items-center justify-between gap-4">
            <span>© {new Date().getFullYear()} FreeLoom. Real learning, formally recorded.</span>
            <div className="flex items-center gap-4">
              <Link href="/terms" className="hover:text-foreground hover:underline">
                Terms
              </Link>
              <Link href="/privacy" className="hover:text-foreground hover:underline">
                Privacy &amp; Cookie Policy
              </Link>
              <CookiePreferencesButton className="hover:text-foreground hover:underline" />
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
