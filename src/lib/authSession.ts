const REMEMBER_KEY = "freeloom-remember-me";
const ALIVE_KEY = "freeloom-session-alive";

/** Supabase's own auth cookie is long-lived (~400 days) no matter what --
 * @supabase/ssr doesn't expose a way to vary that per sign-in, and its
 * browser client is a cached singleton besides (a second createClient()
 * call with different cookie options wouldn't even take effect). This
 * layers "actually forget me once the browser closes" on top using storage
 * this app fully controls: localStorage records the parent's choice and
 * survives a browser restart; sessionStorage is cleared the moment the
 * browser (not just the tab) actually closes. Comparing the two on the
 * next load tells us whether this is a fresh browser launch following a
 * session that opted out of being remembered. */
export function recordRememberMeChoice(remember: boolean) {
  window.localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
  window.sessionStorage.setItem(ALIVE_KEY, "1");
}

/** True when the signed-in session should be ended because the parent
 * chose not to be remembered and the browser has been closed and reopened
 * since. Accounts that predate this feature (no stored choice yet) default
 * to the previous, always-persistent behavior rather than being logged out
 * unexpectedly. */
export function shouldForceSignOutForRememberMe(): boolean {
  if (typeof window === "undefined") return false;
  const remembered = window.localStorage.getItem(REMEMBER_KEY);
  if (remembered !== "false") return false;
  return window.sessionStorage.getItem(ALIVE_KEY) !== "1";
}

export function clearRememberMeMarkers() {
  window.localStorage.removeItem(REMEMBER_KEY);
  window.sessionStorage.removeItem(ALIVE_KEY);
}
