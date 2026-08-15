import type { HTMLAttributes } from "react";

/**
 * The "surface" card idiom (dark bg-surface panel, as opposed to the
 * deliberately distinct light parchment-record idiom used for formal
 * records -- see RecordCard.tsx -- which stays a separate, hand-styled
 * component since it's a different visual language on purpose, not a
 * drift to fix). Before this component, every surface card hand-wrote its
 * own class string and the radius/padding/shadow drifted slightly between
 * pages (rounded-md vs rounded-lg, p-3 vs p-4). This centralizes that one
 * pattern so it can't drift again.
 */
export default function Card({
  active = false,
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { active?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 shadow-sm transition-colors ${
        active ? "border-gold bg-surface" : "border-border bg-surface"
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
