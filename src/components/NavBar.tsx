"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
  { href: "/log", label: "Learning Log" },
  { href: "/transcript", label: "Transcript" },
  { href: "/portfolio", label: "Portfolio" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="border-b border-border bg-surface/60 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-5xl flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-wide">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-gold to-violet text-background font-bold">
            F
          </span>
          <span>FREELOOM</span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          {user &&
            LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-md transition-colors ${
                    active ? "bg-surface-hover text-gold" : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          {user ? (
            <button onClick={signOut} className="px-3 py-2 rounded-md text-muted hover:text-foreground hover:bg-surface-hover">
              Sign out
            </button>
          ) : (
            <Link href="/login" className="btn-primary text-xs px-3 py-2">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
