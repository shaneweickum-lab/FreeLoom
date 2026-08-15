"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { meetsMinimumStrength } from "@/lib/passwordStrength";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";
import LogoMark from "@/components/LogoMark";

/**
 * Where a password-reset email link lands after /auth/confirm/route.ts
 * verifies its token_hash server-side (type=recovery) and redirects here --
 * that verification already establishes a real session via cookies, so
 * this page doesn't need its own token handling, just a plain
 * supabase.auth.updateUser({ password }) once a new one is entered.
 * checkingSession guards against someone landing here directly (an
 * expired/already-used link, or just typing the URL) with no session at all.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user);
      setCheckingSession(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!meetsMinimumStrength(password)) {
      setError("Choose a stronger password -- add more length or mix in a number/symbol.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  return (
    <div className="mx-auto max-w-sm flex flex-col gap-8 py-16 px-4 sm:px-6">
      <div className="text-center">
        <div className="inline-flex mb-4">
          <LogoMark size={48} />
        </div>
        <h1 className="text-2xl font-bold font-serif">Set a new password</h1>
      </div>

      {checkingSession ? (
        <p className="text-muted text-sm text-center">Checking your reset link…</p>
      ) : !hasSession ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-6 text-center">
          <p className="text-sm text-muted">
            That reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
          <button onClick={() => router.push("/login")} className="btn-primary w-fit mx-auto">
            Back to sign in
          </button>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface shadow-sm p-6 text-center">
          <p className="text-sm text-gold">Your password has been updated.</p>
          <button onClick={() => router.push("/dashboard")} className="btn-primary w-fit mx-auto">
            Continue to dashboard
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-surface shadow-sm p-6">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">New password</span>
            <input
              type="password"
              required
              minLength={8}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <PasswordStrengthMeter password={password} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Confirm new password</span>
            <input
              type="password"
              required
              minLength={8}
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Please wait…" : "Update password"}
          </button>
        </form>
      )}
    </div>
  );
}
