export const INACTIVITY_TIMEOUT_MS = 72 * 60 * 60 * 1000;

/** True once more than INACTIVITY_TIMEOUT_MS has passed since lastActiveIso.
 * A missing or unparseable timestamp is treated as "not expired" -- there's
 * nothing to compare against yet (first request after sign-in), or the
 * cookie was corrupted, and either way the caller is about to overwrite it
 * with a fresh timestamp rather than needing to lock the user out over a
 * parsing edge case. */
export function isInactive(lastActiveIso: string | undefined | null, nowMs: number): boolean {
  if (!lastActiveIso) return false;
  const lastActiveMs = Date.parse(lastActiveIso);
  if (Number.isNaN(lastActiveMs)) return false;
  return nowMs - lastActiveMs > INACTIVITY_TIMEOUT_MS;
}
