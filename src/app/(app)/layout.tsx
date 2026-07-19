"use client";

import { StudentProvider } from "@/lib/studentContext";
import AppRail from "@/components/AppRail";

// The persistent left rail from the app redesign brief: brand mark, the
// student switcher, nav links, and the per-subject credit ledger, all in
// one column that stays put while the main content area changes. Stacks
// above the content on mobile instead of a sidebar (AppRail renders its own
// compact top bar + off-canvas drawer below md).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentProvider>
      <div className="flex flex-col md:flex-row min-h-screen">
        <AppRail />
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-8 sm:py-10">{children}</main>
      </div>
    </StudentProvider>
  );
}
