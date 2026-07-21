"use client";

import { useTheme, type Theme } from "@/lib/themeContext";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export default function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-sm">
        Saved to your account, so it follows you to any device you sign in on.
      </p>
      <div className="inline-flex w-fit rounded-lg border border-navy-line p-1 gap-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              theme === opt.value ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
