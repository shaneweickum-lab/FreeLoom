/** The signature "stitched thread" divider between a raw note and its
 * formal record -- a dashed gold rule, oriented horizontal when stacked
 * (mobile) and vertical between side-by-side cards (desktop): two elements,
 * swapped via Tailwind's responsive display utilities since the inline
 * background-image gradient direction can't itself respond to a breakpoint.
 * Static by design; the global prefers-reduced-motion rule in globals.css
 * means any future animated variant here is automatically safe too. */
export default function StitchDivider() {
  return (
    <>
      <div
        aria-hidden
        className="sm:hidden h-2 w-full shrink-0"
        style={{
          backgroundImage: "repeating-linear-gradient(90deg, var(--gold) 0 10px, transparent 10px 18px)",
          backgroundSize: "18px 2px",
          backgroundRepeat: "repeat-x",
          backgroundPosition: "center",
        }}
      />
      <div
        aria-hidden
        className="hidden sm:block w-2 shrink-0 self-stretch"
        style={{
          backgroundImage: "repeating-linear-gradient(180deg, var(--gold) 0 10px, transparent 10px 18px)",
          backgroundSize: "2px 18px",
          backgroundRepeat: "repeat-y",
          backgroundPosition: "center",
        }}
      />
    </>
  );
}
