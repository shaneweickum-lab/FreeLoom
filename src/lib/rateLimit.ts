import type { NextRequest } from "next/server";

/** In-memory, per-instance sliding-window limiter -- not a substitute for a
 * real shared store (Redis/Upstash), which this project doesn't have
 * provisioned. On Vercel's serverless functions this resets on cold starts
 * and isn't shared across concurrent instances, so it won't stop a
 * determined, distributed attacker. It DOES meaningfully raise the bar
 * against the much more common case (a single script or browser hammering
 * an endpoint from one place), which today has zero protection at all. */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true if `key` has exceeded `limit` requests within `windowMs`.
 * Each call counts as one request. */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

/** Vercel/most proxies set x-forwarded-for to "client, proxy1, proxy2" --
 * the first entry is the original client. Falls back to a constant key
 * when neither header is present (e.g. local dev), which just means local
 * requests all share one bucket -- acceptable since this only matters in
 * front of a real proxy. */
export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
