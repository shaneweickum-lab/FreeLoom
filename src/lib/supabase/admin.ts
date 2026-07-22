import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Service-role client -- bypasses RLS entirely, so it only exists
 * server-side, for the handful of things that genuinely have no
 * RLS-enforced session to act through: looking up an existing account by
 * email via the Auth admin API, the daily cleanup-threads cron
 * (/api/cron/cleanup-threads), and the Stripe webhook handler
 * (/api/webhooks/stripe) -- Stripe calls that route directly, with no
 * logged-in user, so there's no session client to use instead. Every
 * actual admin_users read/write still goes through the RLS-enforced
 * session client, not this one. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
