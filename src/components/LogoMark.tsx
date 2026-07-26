import Image from "next/image";

/**
 * FreeLoom's real brand mark: a navy/gold circular seal (a woven "F" beside
 * a hand-notated scroll, "FREELOOM" around the border) -- replaces the
 * hand-drawn placeholder this component used to render. Source art is
 * public/FreeLoom-Logo.png (1024x1024, transparent background). If the
 * source art changes, also regenerate: src/app/icon.png (static 512x512
 * resize), src/app/apple-icon.png (static 180x180 resize, Apple's
 * documented @3x home-screen icon size), src/app/favicon.ico (16/32/48px,
 * the legacy fallback), and public/FreeLoom-Logo-og.png (240x240 resize,
 * read by src/app/opengraph-image.tsx -- the one spot that has to stay
 * code-generated rather than a static file, see its own doc comment).
 */
export default function LogoMark({ size = 40 }: { size?: number }) {
  return <Image src="/FreeLoom-Logo.png" alt="FreeLoom" width={size} height={size} className="shrink-0" />;
}
