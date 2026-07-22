import Link from "next/link";

const LAST_UPDATED = "July 22, 2026";

/** Standalone page (like /login, /onboarding) -- reachable both signed out
 * (landing page footer) and signed in (Settings > About), so it deliberately
 * doesn't sit inside the (app) route group's nav-rail chrome. */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl w-full flex flex-col gap-8 py-16 px-4 sm:px-6">
      <div className="text-center">
        <Link
          href="/"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-gold to-violet text-ink text-xl font-bold mb-4"
        >
          F
        </Link>
        <h1 className="text-2xl font-bold font-serif">Privacy &amp; Cookie Policy</h1>
        <p className="text-muted text-sm mt-2">Last updated {LAST_UPDATED}.</p>
      </div>

      <div className="rounded-lg border border-navy-line bg-navy-soft px-4 py-3 text-sm text-muted">
        This page describes exactly what FreeLoom&apos;s code collects and stores as of the date above. Questions
        about anything on it are welcome any time -- see the Questions section below.
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">The short version</h2>
        <ul className="list-disc list-inside text-sm text-muted flex flex-col gap-1.5">
          <li>FreeLoom sets exactly one cookie: the one that keeps you signed in. Nothing else, no analytics, no ads.</li>
          <li>We store what you type in: parent account info, student profiles, learning entries, and support messages.</li>
          <li>Billing is handled by Stripe -- we never see or store your card number.</li>
          <li>
            We don&apos;t sell data, and we don&apos;t share it with anyone except the service providers listed
            below, who only process it on our behalf.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">Cookies &amp; local storage</h2>
        <p className="text-sm text-muted">FreeLoom uses exactly two client-side storage mechanisms:</p>
        <div className="rounded-lg border border-navy-line overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-soft text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">What</th>
                <th className="text-left px-4 py-2 font-medium">Purpose</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-navy-line">
                <td className="px-4 py-2 font-mono text-xs">sb-...-auth-token (cookie)</td>
                <td className="px-4 py-2 text-muted">Keeps you signed in between visits.</td>
                <td className="px-4 py-2 text-muted">Strictly necessary</td>
              </tr>
              <tr className="border-t border-navy-line">
                <td className="px-4 py-2 font-mono text-xs">freeloom-current-student-id (local storage)</td>
                <td className="px-4 py-2 text-muted">Remembers which student profile you last had selected.</td>
                <td className="px-4 py-2 text-muted">Functional</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          We don&apos;t currently use analytics, advertising, or any third-party tracking cookies. The cookie banner
          you may have seen has Analytics and Marketing categories in it anyway, reserved in case that changes in
          the future -- if it ever does, this page and that banner will both be updated, and you&apos;ll be asked
          again before anything new is set. You can revisit your choice any time from the{" "}
          <span className="italic">Cookie preferences</span>
          {" "}
          link in the footer, or in Settings &gt; About if you&apos;re signed in.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">What we collect</h2>
        <ul className="list-disc list-inside text-sm text-muted flex flex-col gap-1.5">
          <li>
            <strong>Your parent account:</strong> email, name, address, phone, state, and how your family learns
            (homeschooling/unschooling/etc.), if you choose to fill those in.
          </li>
          <li>
            <strong>Student profiles:</strong> name and birthdate for each student you add. You can hide student
            names and birthdates from the transcripts/portfolios you export, in Settings.
          </li>
          <li>
            <strong>Learning records:</strong>{" "}
            whatever you write about your student&apos;s activities, and the class entries, transcripts, and
            portfolios generated from them.
          </li>
          <li>
            <strong>Messages:</strong> conversations between you and the FreeLoom team, and any account-access
            requests you approve or deny.
          </li>
          <li>
            <strong>Billing:</strong> your subscription plan and status. Payment details themselves are collected
            and stored by Stripe directly -- FreeLoom never receives or stores your card number. Charges are final
            (no refunds), but you can cancel any time and keep access through the end of the period you already
            paid for -- see our{" "}
            <Link href="/terms" className="text-gold hover:underline">
              Terms of Service
            </Link>{" "}
            for the full billing terms.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">Children&apos;s information</h2>
        <p className="text-sm text-muted">
          Student profiles are entered by the parent/guardian who controls the account -- FreeLoom doesn&apos;t
          collect information directly from a child, and children don&apos;t have their own login. If you&apos;re a
          parent adding your own child&apos;s information, that&apos;s what this feature is for. This distinction
          matters under laws like the U.S. Children&apos;s Online Privacy Protection Act (COPPA), but exactly how it
          applies can depend on specifics we&apos;re not positioned to judge for you -- get real legal advice here
          specifically before treating this section as sufficient.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">Who else sees it</h2>
        <p className="text-sm text-muted">
          We use a small number of service providers to run FreeLoom, each only processing what they need to
          provide their part of the service:
        </p>
        <ul className="list-disc list-inside text-sm text-muted flex flex-col gap-1.5">
          <li><strong>Supabase</strong> -- database, authentication, and file storage.</li>
          <li><strong>Stripe</strong> -- billing and payment processing.</li>
          <li><strong>Resend</strong> -- delivering transactional emails (confirmations, notifications).</li>
          <li><strong>Vercel</strong> -- hosting the application.</li>
        </ul>
        <p className="text-sm text-muted">
          A small number of admin accounts on the FreeLoom team can access account and support data to help with
          support requests. Any admin request for read-only access to your account requires your explicit approval
          first, is time-limited, and is visible to you the entire time it&apos;s active.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">How long we keep it</h2>
        <p className="text-sm text-muted">
          Support message threads auto-delete after a period you can configure (7 days on the Free plan, up to 30
          days -- or never, on paid plans). Learning records, transcripts, and portfolios are kept for as long as
          your account is active, since they&apos;re the actual point of the product. If you downgrade to a plan
          with a lower student limit, existing student profiles beyond that limit are preserved (not deleted) but
          locked from new edits until your plan covers them again.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">Your choices</h2>
        <ul className="list-disc list-inside text-sm text-muted flex flex-col gap-1.5">
          <li>Edit or correct your account and student information any time in Settings.</li>
          <li>Hide student names/birthdates from exported transcripts and portfolios.</li>
          <li>Choose how long message threads are kept before auto-deleting (plan-dependent).</li>
          <li>Download a copy of your data, or close your account entirely, any time in Settings &gt; Account.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-bold">Questions</h2>
        <p className="text-sm text-muted">
          The fastest way to reach us is through the Messages feature in your account, if you&apos;re signed in.
          Otherwise, email{" "}
          <a href="mailto:shane@sowedandrooted.com" className="text-gold hover:underline">
            shane@sowedandrooted.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
