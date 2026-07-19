"use client";

import { StudentProvider } from "@/lib/studentContext";
import StudentSwitcher from "@/components/StudentSwitcher";
import NavBar from "@/components/NavBar";

// NavBar + the main wrapper + footer used to live in the root layout,
// shared by every route. Moved here because the landing page now has its
// own self-contained nav/footer (see src/app/page.tsx) -- this is the
// authenticated app's own chrome. Slated to become the left-rail layout
// from the app redesign brief; until then this keeps every existing
// authenticated page looking and working exactly as before.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentProvider>
      <NavBar />
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-col gap-6">
          <StudentSwitcher />
          {children}
        </div>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 text-xs text-muted flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} FreeLoom. Real learning, formally recorded.</span>
          <span>A record-keeping platform for unschooling and wildschooling families.</span>
        </div>
      </footer>
    </StudentProvider>
  );
}
