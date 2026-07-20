"use client";

import { useEffect, useState } from "react";

/** mm:ss (or h:mm:ss past an hour, though nothing here grants more than
 * one hour at a time) -- pure so it's unit-testable without a timer. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Ticks once a second while `expiresAt` is set and in the future.
 * Date.now() can't be called during render (impure), so the remaining time
 * only ever gets computed inside the effect/interval, never in the render
 * body itself. */
export function useCountdown(expiresAt: string | null) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemainingMs(0);
      return;
    }
    const target = new Date(expiresAt).getTime();
    setRemainingMs(Math.max(0, target - Date.now()));
    const interval = setInterval(() => setRemainingMs(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return { remainingMs, expired: expiresAt !== null && remainingMs <= 0, label: formatCountdown(remainingMs) };
}
