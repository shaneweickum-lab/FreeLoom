import Link from "next/link";
import { APP_VERSION } from "@/lib/appVersion";
import CookiePreferencesButton from "@/components/CookiePreferencesButton";
import Card from "@/components/ui/Card";

const ABOUT_FEATURES = [
  "Learning Log with AI-assisted subject tagging and plain-language reasoning",
  "Transcript builder with GPA, letter grades, and branded PDF export",
  "Portfolio organized by class, not a folder of loose files",
  "Multi-student support — one account for your whole family",
  "Direct messaging with the FreeLoom team, organized into conversations",
  "Real-time notifications and announcements tailored to how your family learns",
];

export default function AboutTab() {
  return (
    <Card variant="flat" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-bold">About FreeLoom</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold font-mono">
          v{APP_VERSION}
        </span>
      </div>
      <p className="text-sm text-muted">
        A transcript builder and record-keeper for alternative schooling families — here&apos;s what&apos;s in it so far:
      </p>
      <ul className="flex flex-col gap-1.5 text-sm text-muted list-disc list-inside">
        {ABOUT_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div className="border-t border-navy-line pt-3">
        <h3 className="text-sm font-semibold">Benny&apos;s AI model</h3>
        <p className="mt-1 text-sm text-muted">
          Benny runs on FreeLoom&apos;s own AI model, trained from scratch in-house rather than a third-party
          service — your questions and word dumps are processed on FreeLoom&apos;s own servers to produce a reply,
          never sent to an outside AI provider.
        </p>
      </div>
      <div className="flex items-center gap-4 border-t border-navy-line pt-3 text-sm">
        <Link href="/terms" className="text-gold hover:underline">
          Terms
        </Link>
        <Link href="/privacy" className="text-gold hover:underline">
          Privacy &amp; Cookie Policy
        </Link>
        <CookiePreferencesButton className="text-muted hover:text-foreground hover:underline" />
      </div>
    </Card>
  );
}
