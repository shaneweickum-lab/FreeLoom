/**
 * Platform-help documentation corpus for Benny assistant-mode chat's RAG
 * grounding (docs/slm-strategy.md Section 1/7's spirit, now serving the
 * live model rather than the retired platform_help LoRA adapter it used
 * to be trained to answer this same category of question). Retrieved
 * chunks get injected into Benny's system prompt (see chatPrompt.ts) so
 * "how does FreeLoom actually work" answers are grounded in real,
 * currently-accurate facts about this codebase instead of the model
 * guessing or hallucinating a plausible-sounding wrong answer.
 *
 * Written as plain TS string constants rather than loose .md files under
 * docs/ -- Next.js has no built-in loader for importing raw markdown into
 * a client bundle, and adding one for a handful of short files isn't
 * worth the extra build-tooling dependency. Each entry's `text` is still
 * genuinely markdown-formatted prose; only the storage location changed
 * from the original batch plan, not the content or its editability.
 *
 * IMPORTANT: every fact below needs to actually be true of this codebase,
 * kept in sync as the product changes -- a stale doc chunk grounding a
 * confidently-wrong answer is arguably worse than no grounding at all.
 * Reviewed for accuracy as of the batch that added this file; re-check
 * this whenever the underlying behavior it describes changes.
 */

export type PlatformDocChunk = {
  id: string;
  heading: string;
  text: string;
};

export const PLATFORM_DOC_CHUNKS: PlatformDocChunk[] = [
  {
    id: "credits-how-calculated",
    heading: "How credit values are calculated",
    text: `Credit values follow the Carnegie unit convention: roughly 150 hours of engaged work per credit for most subjects, or 180 hours per credit for lab sciences (biology, chemistry, physics, anatomy/physiology, environmental/earth/marine science, forensic science, astronomy). A class is marked "lab science" automatically based on its subject area, but a parent can correct that guess on the Portfolio page if it's wrong.

Credit values round to the nearest 0.01 (not a coarser 0.25 step), and a genuinely-logged activity always shows at least 0.01 credit, never zero. If no time was logged for an entry at all, a small fallback credit value is used instead of guessing a duration.`,
  },
  {
    id: "credits-goals",
    heading: "Setting a credit goal",
    text: `A parent can set a target credit amount on any class from the Portfolio page, right next to that class's running credit total. Once set, the left-hand sidebar's subject ledger shows a progress bar toward that goal. Leaving it blank just shows the accumulated total with no target -- nothing is invented if a goal was never set.`,
  },
  {
    id: "pipeline-overview",
    heading: "How a logged activity gets classified (how FreeLoom decides its subject)",
    text: `When a word dump is submitted, FreeLoom decides its subject area and course by running it through up to five stages:

1. It's checked against a knowledge base of known activities and keyword clusters. A confident match (a real knowledge-base entry, not just a generic keyword cluster) returns immediately with a subject, course title, and credit value already filled in.
2. If only a generic cluster matched, FreeLoom checks whether a similar word dump was accepted before for this same student, and reuses that past decision if so.
3. If neither of those found anything specific, a more detailed course title and reasoning gets composed from known building blocks for that generic cluster.
4. If everything above misses entirely, Benny (running Llama 3.2 1B in your own browser) drafts a candidate subject/title/credit/reasoning -- but only ever offered if an independent, non-AI classifier agrees the drafted subject is at least plausible; if the two disagree, no draft is shown at all rather than risking a wrong one.
5. Whatever's left is a blank (or Benny-drafted) form the parent fills in and saves themselves. Every entry resolved this way becomes a candidate for stage 2/3 to reuse on a future similar activity.

FreeLoom also checks whether a new word dump looks suspiciously similar to something already logged for that student earlier the same day, and asks before saving it, to avoid accidentally double-crediting one activity logged twice.`,
  },
  {
    id: "settings-overview",
    heading: "What each Settings tab does",
    text: `Account: parent/contact info, sign-in email, password, downloading a full data export, or deleting the account entirely.
Appearance: light/dark theme, saved to the account so it follows across devices.
Notifications: email and in-app toggles for messages, announcements, and logging-streak reminders, plus how long inactive message threads are kept before auto-deleting.
Academic: the family's school-year/session structure (quarters, trimesters, semesters, or none).
Household: inviting or removing a second guardian on the account.
Billing: current plan, upgrading/downgrading, and managing payment through Stripe's own portal.
About: which AI model is currently powering Benny, and general app information.`,
  },
  {
    id: "household-second-guardian",
    heading: "Inviting a second guardian",
    text: `The account owner can invite one other adult by email from Settings > Household. Once that person accepts (by signing in or creating an account with the invited email), they get full access to log activities, review and edit entries, message support, and generate transcripts -- the same as the original owner. Billing and account deletion always stay exclusive to the original account owner, regardless of how many guardians are on the household. An accepted guardian can't invite further guardians themselves; only the original owner can.`,
  },
  {
    id: "benny-ai-model",
    heading: "What model powers Benny",
    text: `Benny's assistant-mode chat and activity-drafting help run Llama 3.2 1B (or a smaller Qwen2.5 model automatically on mobile devices) directly in your own browser, using your device's graphics hardware (WebGPU) -- not a server, and not FreeLoom's own from-scratch-trained model, which is a deliberate, current choice while better training infrastructure is being built, not a permanent one. The model downloads once (a genuinely large file) and stays cached in your browser for later visits. It needs a browser/device with WebGPU support, and your consent in the cookie banner (or turning it on in Settings) before it will download at all.`,
  },
  {
    id: "research-library",
    heading: "The Research Library and citations",
    text: `Some logged activities get tagged with a "Backed by research" note linking to a real academic source about that subject or educational approach. Those citations come from FreeLoom's own Research Library -- a browsable, searchable collection of citations about alternative-education approaches (unschooling, interest-led learning, game-based learning, and similar), independent of any specific logged entry.`,
  },
];
