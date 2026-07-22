import { scorePassword } from "@/lib/passwordStrength";

const LABEL: Record<ReturnType<typeof scorePassword>["strength"], string> = {
  weak: "Weak",
  good: "Good",
  strong: "Strong",
};

const BAR_COLOR: Record<ReturnType<typeof scorePassword>["strength"], string> = {
  weak: "bg-red-500",
  good: "bg-gold",
  strong: "bg-emerald-500",
};

const TEXT_COLOR: Record<ReturnType<typeof scorePassword>["strength"], string> = {
  weak: "text-red-400",
  good: "text-gold",
  strong: "text-emerald-400",
};

// Three segments filled proportionally to score (0-7 from scorePassword)
// rather than one per strength tier, so the bar visibly grows as a parent
// types instead of jumping straight from empty to full at each tier.
const SEGMENTS = 3;

export default function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { strength, score } = scorePassword(password);
  const filled = Math.min(SEGMENTS, Math.ceil((score / 7) * SEGMENTS));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i < filled ? BAR_COLOR[strength] : "bg-navy-line"}`}
          />
        ))}
      </div>
      <span className={`text-xs ${TEXT_COLOR[strength]}`}>{LABEL[strength]} password</span>
    </div>
  );
}
