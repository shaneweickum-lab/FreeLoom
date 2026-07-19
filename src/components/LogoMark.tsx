/**
 * Placeholder brand mark: a two-tone (gold/violet) woven "F" on a navy
 * square, meant to evoke the product's name (a loom). This is a stand-in,
 * not final brand art -- flag for real logo design later. The two offset
 * strokes are a cheap approximation of a woven/interlaced look without
 * needing true path-braiding.
 */
export default function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-navy-line bg-navy-soft"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.55} height={size * 0.55} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 26V9h13" stroke="var(--violet)" strokeWidth="3.25" transform="translate(1.2,-1.2)" />
        <path d="M10 25V8h13M10 16h9.5" stroke="var(--gold)" strokeWidth="2.75" />
      </svg>
    </span>
  );
}
