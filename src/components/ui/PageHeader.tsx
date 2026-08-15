import type { ReactNode } from "react";

/**
 * The h1+subtitle block every top-level page opens with. Existed as a
 * hand-copied pattern before this component -- most pages used
 * `font-serif text-2xl font-bold` + a `mt-1` subtitle, but a handful
 * (dashboard, profile, portfolio, transcript, log) had drifted to a
 * slightly different variant (no font-serif, `mb-1` instead of a `mt-1`
 * subtitle). This is the canonical version every page should use going
 * forward, matching the majority pattern rather than either drifted one.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h1 className="font-serif text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
