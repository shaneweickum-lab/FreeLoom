"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { resolveHouseholdOwnerId } from "@/lib/household";
import { useBennyPanel } from "@/lib/bennyPanelContext";
import { BENNY_ASSISTANT_MODE_LAUNCHED, isBennyAvailable } from "@/lib/billing/tier";
import StudentSwitcher from "@/components/StudentSwitcher";
import LogoMark from "@/components/LogoMark";
import NotificationBell from "@/components/NotificationBell";
import AdminAccessIndicator from "@/components/AdminAccessIndicator";
import type { User } from "@supabase/supabase-js";
import type { SchoolProfile } from "@/lib/types";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
  { href: "/log", label: "Learning Log" },
  { href: "/transcript", label: "Transcript" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/research", label: "Research Library" },
  { href: "/messages", label: "Messages" },
  { href: "/notifications", label: "Notifications" },
  { href: "/settings", label: "Settings" },
];

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1.3-3.9a8.38 8.38 0 0 1-1-4A8.38 8.38 0 0 1 11.8 3.6a8.5 8.5 0 0 1 9.2 8.9Z" />
    </svg>
  );
}

type BennyGateProfile = Pick<
  SchoolProfile,
  | "benny_assistant_enabled"
  | "subscription_tier"
  | "subscription_status"
  | "grandfathered_until"
  | "current_period_end"
  | "benny_trial_ends_at"
>;

/** Only renders once the signed-in user has opted into Benny assistant mode
 * (Settings > Account) -- fetches its own enabled state the same
 * self-contained way AdminAccessIndicator/NotificationBell do, so it can be
 * dropped into both the desktop rail and the mobile top bar with no prop
 * drilling. Toggling the panel is all this does -- the actual drawer lives
 * at the AppShell level, see BennyPanel.tsx.
 *
 * Stays live via a postgres_changes subscription on this user's own
 * school_profiles row (same pattern as useNotifications.ts) -- flipping the
 * toggle in Settings, or a plan change taking effect, should make the chat
 * icon appear/disappear immediately in every open tab, not just after the
 * next full page load. */
function BennyTriggerButton() {
  const { toggle } = useBennyPanel();
  const [enabled, setEnabled] = useState(false);
  // Two instances render at once (desktop rail + mobile top bar, one just
  // CSS-hidden) -- see useNotifications.ts's instanceId comment for why each
  // needs its own realtime channel topic.
  const instanceId = useId();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getUser().then(async ({ data }) => {
      const userId = data.user?.id;
      if (!userId || cancelled) return;
      const ownerId = await resolveHouseholdOwnerId(supabase, userId);
      if (!ownerId || cancelled) return;

      const [{ data: profile }, { data: adminRow }] = await Promise.all([
        supabase
          .from("school_profiles")
          .select(
            "benny_assistant_enabled, subscription_tier, subscription_status, grandfathered_until, current_period_end, benny_trial_ends_at"
          )
          .eq("user_id", ownerId)
          .maybeSingle(),
        supabase.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle(),
      ]);
      const isAdmin = !!adminRow;

      // Free tier never sees Benny at all unless still inside its one-time
      // trial window (isBennyAvailable) -- see AccountTab.tsx, where the
      // toggle itself is also gated so a locked-out parent can't even turn
      // this on to find it hidden anyway.
      function computeEnabled(p: BennyGateProfile | null) {
        const available = isBennyAvailable({
          subscription_tier: p?.subscription_tier ?? "free",
          subscription_status: p?.subscription_status ?? null,
          grandfathered_until: p?.grandfathered_until ?? null,
          current_period_end: p?.current_period_end ?? null,
          benny_trial_ends_at: p?.benny_trial_ends_at ?? null,
          isAdmin,
        });
        return BENNY_ASSISTANT_MODE_LAUNCHED && !!p?.benny_assistant_enabled && available;
      }

      if (cancelled) return;
      setEnabled(computeEnabled(profile));

      channel = supabase
        .channel(`benny-enabled:${ownerId}:${instanceId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "school_profiles", filter: `user_id=eq.${ownerId}` },
          (payload) => setEnabled(computeEnabled(payload.new as BennyGateProfile))
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [instanceId]);

  if (!enabled) return null;

  return (
    <button
      onClick={toggle}
      aria-label="Ask Benny"
      className="h-9 w-9 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
    >
      <ChatIcon />
    </button>
  );
}

/** One subject's ribbon-fill progress bar: a gold gradient with a subtle
 * diagonal stitch texture layered on top via a second repeating-gradient
 * background, rather than an image asset. No fabricated denominator when
 * target_credits isn't set -- just the accumulated total. */
function LedgerRow({ subjectArea, creditHours, targetCredits }: { subjectArea: string; creditHours: number; targetCredits: number | null }) {
  const pct = targetCredits ? Math.min(100, (creditHours / targetCredits) * 100) : 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground/90 truncate">{subjectArea}</span>
        <span className="text-muted font-mono shrink-0">
          {creditHours.toFixed(2)}
          {targetCredits ? ` / ${targetCredits.toFixed(2)}` : ""}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-navy-line overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${targetCredits ? pct : 100}%`,
            opacity: targetCredits ? 1 : 0.45,
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(10,13,28,0.18) 0 3px, transparent 3px 7px), linear-gradient(90deg, var(--gold), var(--gold-bright))",
          }}
        />
      </div>
    </div>
  );
}

function RailContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { subjectLedger } = useStudents();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (!data.user) return;
      supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle()
        .then(({ data: adminRow }) => setIsAdmin(!!adminRow));
    });
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 font-semibold tracking-wide">
          <LogoMark size={32} />
          <span className="font-serif">FREELOOM</span>
        </Link>
        <div className="flex items-center gap-1">
          {user && <BennyTriggerButton />}
          {user && <NotificationBell />}
        </div>
      </div>

      {user && <AdminAccessIndicator />}

      <StudentSwitcher />

      <nav className="flex flex-col gap-1 text-sm">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={`border-l-2 px-3 py-2 transition-colors ${
                active
                  ? "border-gold bg-surface-hover text-gold"
                  : "border-transparent text-muted hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={`border-l-2 px-3 py-2 transition-colors ${
              pathname === "/admin"
                ? "border-violet-soft bg-surface-hover text-violet-soft"
                : "border-transparent text-muted hover:text-foreground hover:bg-surface-hover"
            }`}
          >
            Admin
          </Link>
        )}
      </nav>

      {subjectLedger.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <span className="text-xs font-mono uppercase tracking-wide text-muted">Credits by subject</span>
          <div className="flex flex-col gap-3">
            {subjectLedger.map((row) => (
              <LedgerRow key={row.subjectArea} {...row} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4 text-xs">
        {user && (
          <button onClick={signOut} className="w-fit text-muted hover:text-foreground transition-colors">
            Sign out
          </button>
        )}
        <span className="text-muted/70">FreeLoom &middot; record-keeping made easy</span>
      </div>
    </div>
  );
}

export default function AppRail() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="md:hidden flex items-center justify-between border-b border-border bg-surface px-4 py-3 sticky top-0 z-20">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-wide">
          <LogoMark size={28} />
          <span className="font-serif text-sm">FREELOOM</span>
        </Link>
        <div className="flex items-center gap-2">
          <AdminAccessIndicator compact />
          <BennyTriggerButton />
          <NotificationBell />
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="h-9 w-9 flex items-center justify-center rounded-md text-foreground hover:bg-surface-hover"
          >
            {mobileOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div aria-hidden onClick={() => setMobileOpen(false)} className="md:hidden fixed inset-0 z-20 bg-navy-deep/70" />
      )}

      <aside
        // z-30 stays in effect at every breakpoint (not just mobile) --
        // <aside> and <main> are siblings with <main> later in the DOM, so
        // without an explicit z-index here, <main>'s content paints above
        // this entire subtree at desktop width once <aside> switches from
        // fixed to sticky, regardless of any z-index set deeper inside it
        // (e.g. NotificationBell's own z-40 dropdown, meant to overlay onto
        // main content, was rendering underneath it instead).
        className={`fixed inset-y-0 left-0 z-30 w-72 border-r border-border bg-surface transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 md:transition-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <RailContent onNavigate={() => setMobileOpen(false)} />
      </aside>
    </>
  );
}
