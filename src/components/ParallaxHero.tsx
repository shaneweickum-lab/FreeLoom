"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import LogoMark from "@/components/LogoMark";

function ScrollArrowIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M12 4v16" />
      <path d="M5 13l7 7 7-7" />
    </svg>
  );
}

/** The landing page's parallax intro: a fixed, full-viewport photo that stays
 * put as the page scrolls (later sections have their own opaque backgrounds
 * and simply paint over it once scrolled that far). The first screen shows
 * only the wordmark and a scroll cue; the nav and the rest of the hero copy
 * fade in and settle into place as the visitor scrolls through the next
 * viewport, driven directly by scroll position rather than a timed animation
 * so it stays inert for prefers-reduced-motion (the fade/shift is instant,
 * only the bounce cue is a real animation, and the global reduced-motion
 * rule in globals.css already zeroes that).
 */
export default function ParallaxHero() {
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    let ticking = false;
    function update() {
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, window.scrollY / (vh * 0.9)));
      setReveal(p);
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  function scrollToReveal() {
    document.getElementById("hero-reveal")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div aria-hidden className="fixed inset-0 -z-20 overflow-hidden">
        <Image src="/IMG_5290.png" alt="" fill preload sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/10 to-background/70" />
        {/* Extra scroll-linked darkening so the hero copy stays legible once it appears. */}
        <div className="absolute inset-0 bg-background" style={{ opacity: 0.2 + reveal * 0.5 }} />
      </div>

      <nav
        className="fixed inset-x-0 top-0 z-30 border-b border-navy-line bg-background/80 backdrop-blur"
        style={{ opacity: reveal, pointerEvents: reveal > 0.05 ? "auto" : "none" }}
      >
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 sm:px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-wide">
            <LogoMark size={36} />
            <span className="font-serif">FREELOOM</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <a href="#how-it-works" className="hidden sm:inline text-muted hover:text-foreground transition-colors">
              How it works
            </a>
            <a href="#features" className="hidden sm:inline text-muted hover:text-foreground transition-colors">
              Features
            </a>
            <Link
              href="/login"
              className="rounded-md border border-gold/40 px-4 py-1.5 font-medium text-gold hover:bg-gold/10 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <h1 className="font-serif text-6xl sm:text-8xl font-bold tracking-tight">FreeLoom</h1>
        <p className="max-w-md text-base sm:text-lg text-foreground/85 tracking-wide [text-shadow:0_2px_16px_rgba(10,13,28,0.85)]">
          Transcript builder and records keeper for alternative schooling families
        </p>
        <button
          onClick={scrollToReveal}
          aria-label="Scroll down"
          className="absolute bottom-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 text-gold animate-bounce hover:bg-gold/10 transition-colors"
        >
          <ScrollArrowIcon className="h-5 w-5" />
        </button>
      </section>

      <section
        id="hero-reveal"
        className="relative min-h-screen scroll-mt-24 flex flex-col items-center justify-center gap-6 px-4 text-center"
        style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px)` }}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold font-mono">
          A record-keeper first, a transcript generator second
        </span>
        <p className="text-xl text-gold font-medium font-serif">Real learning, formally recorded.</p>
        <p className="max-w-2xl text-muted text-base leading-relaxed">
          Built for unschooling and wildschooling families: log the informal, unstructured, real
          stuff your kids actually do, and FreeLoom turns it into a structured class entry with
          its reasoning shown right alongside it — so you can see exactly why, not just trust that
          it&apos;s right. A transcript is something you generate from that record when you need one,
          not the thing you&apos;re stuck maintaining every day.
        </p>
        <div className="flex flex-wrap justify-center gap-4 mt-2">
          <Link
            href="/login"
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-ink shadow-sm hover:bg-gold-hover hover:shadow-md transition-all"
          >
            Get Started
          </Link>
          <a
            href="#how-it-works"
            className="rounded-md border border-border bg-surface px-5 py-2.5 font-medium text-foreground shadow-sm hover:bg-surface-hover transition-colors"
          >
            See how it works
          </a>
        </div>
      </section>
    </>
  );
}
