import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Service-role client -- bypasses RLS entirely, so it only exists server-side
 * and only for the one thing that genuinely needs elevated privilege: looking
 * up an existing account by email via the Auth admin API (the regular
 * anon/authenticated client has no way to search auth.users). Every actual
 * admin_users read/write still goes through the RLS-enforced session client,
 * not this one. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
