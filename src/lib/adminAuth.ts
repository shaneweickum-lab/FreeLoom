import { createClient } from "@/lib/supabase/server";

/** Shared by every admin-only API route. Whether this account can even read
 * its own admin_users row is itself the authorization check -- the
 * admin_users_admin_select RLS policy (is_admin()) only lets that query
 * through for accounts already in the table. */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false };

  const { data } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  return { supabase, user, isAdmin: !!data };
}
