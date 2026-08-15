import type { HTMLAttributes } from "react";

/**
 * Two card idioms exist across the app, both legitimate (not drift to
 * fix into one), just previously uncentralized:
 *  - "surface" (default): a dark bg-surface panel with a shadow, used for
 *    freestanding content (dashboard student cards, citation cards).
 *  - "flat": a lighter, unfilled outline used for stacking many small
 *    sections inside one view (every Settings tab) -- a shadow/fill on
 *    each one would look heavy once several are stacked per tab.
 * Before this component, every card hand-wrote its own class string and
 * drifted slightly (rounded-md vs rounded-lg, p-3 vs p-4, and Billing's
 * two sections were the only "flat" instances using p-4 instead of every
 * other tab's p-3). This centralizes each pattern so it can't drift again.
 *
 * Deliberately NOT used for RecordCard's parchment idiom (a different
 * visual language on purpose) or for tinted semantic states (a current-
 * plan/danger/attention box) -- those carry meaning this neutral
 * container isn't meant to express.
 */
export type CardVariantProps = {
  variant?: "surface" | "flat";
  active?: boolean;
  /** Only meaningful on the "surface" variant -- "flat" always uses p-3. */
  padding?: "md" | "lg";
};

/**
 * The same class-building logic Card itself renders with, exported
 * separately for the handful of surface-card-styled elements that can't be
 * a `<div>` -- CaptureCard/StudentForm/OnboardingWizard are `<form>`s, so
 * they use this directly (`className={cardClassName({...})}`) rather than
 * `<Card>`, without hand-maintaining a second copy of the class string.
 */
export function cardClassName({ variant = "surface", active = false, padding }: CardVariantProps = {}): string {
  return variant === "flat"
    ? "rounded-lg border border-navy-line p-3 transition-colors"
    : `rounded-lg border ${padding === "lg" ? "p-6" : "p-4"} shadow-sm ${
        active ? "border-gold bg-surface" : "border-border bg-surface"
      } transition-colors`;
}

export default function Card({
  variant = "surface",
  active = false,
  padding,
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & CardVariantProps) {
  return (
    <div className={`${cardClassName({ variant, active, padding })} ${className}`} {...rest}>
      {children}
    </div>
  );
}
