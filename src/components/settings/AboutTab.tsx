import Link from "next/link";
import { APP_VERSION } from "@/lib/appVersion";
import CookiePreferencesButton from "@/components/CookiePreferencesButton";
import Card from "@/components/ui/Card";
import { LLAMA_3_2_1B, QWEN_2_5_0_5B } from "@/lib/benny/webllm/models";

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
          Benny currently runs on <strong className="text-foreground">{LLAMA_3_2_1B.label}</strong> (or{" "}
          <strong className="text-foreground">{QWEN_2_5_0_5B.label}</strong> automatically on mobile devices),
          downloaded once and run directly in your browser using your device&apos;s graphics hardware (WebGPU) — not
          on a FreeLoom server. This is a deliberate, current choice while FreeLoom&apos;s own from-scratch-trained
          model gets better training infrastructure, not a permanent direction. Downloading the model requires your
          consent — see the AI model option in cookie preferences below.
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
