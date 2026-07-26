"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { meetsMinimumStrength } from "@/lib/passwordStrength";
import { recordRememberMeChoice } from "@/lib/authSession";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";
import LogoMark from "@/components/LogoMark";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "confirmation_failed"
      ? "That confirmation link is invalid or has expired. Try signing up again."
      : searchParams.get("reason") === "inactivity"
      ? "You were signed out after 72 hours of inactivity. Sign in again to continue."
      : null
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "signup" && !meetsMinimumStrength(password)) {
      setError("Choose a stronger password -- add more length or mix in a number/symbol.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setSubmitting(false);
        return;
      }
      recordRememberMeChoice(keepSignedIn);
      router.push(next);
      router.refresh();
    } else {
      // A brand-new account always goes through onboarding (set up profile,
      // then pick a plan) rather than the caller-supplied `next` -- that's
      // only meant for signin's "come back to what you were doing".
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding` },
      });
      if (error) {
        setError(error.message);
        setSubmitting(false);
        return;
      }
      if (data.session) {
        recordRememberMeChoice(keepSignedIn);
        router.push("/onboarding");
        router.refresh();
      } else {
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="mx-auto max-w-sm flex flex-col gap-8 py-16 px-4 sm:px-6">
      <div className="text-center">
        <Link href="/" className="inline-flex mb-4">
          <LogoMark size={48} />
        </Link>
        <h1 className="text-2xl font-bold font-serif">{mode === "signin" ? "Sign in" : "Create your parent account"}</h1>
        <p className="text-muted text-sm mt-2">
          {mode === "signin"
            ? "One account for your whole family."
            : "Add a profile for each of your students once you're in."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-surface shadow-sm p-6">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Email</span>
          <input
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Password</span>
          <input
            type="password"
            required
            minLength={mode === "signup" ? 8 : 6}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === "signup" && <PasswordStrengthMeter password={password} />}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(e) => setKeepSignedIn(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-gold"
          />
          <span className="text-muted">Keep me signed in</span>
        </label>
        {mode === "signup" && (
          <label className="flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              required
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              I&apos;m 18 or older and the parent/guardian of any student I add. I agree to FreeLoom&apos;s{" "}
              <Link href="/terms" target="_blank" className="text-gold hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank" className="text-gold hover:underline">
                Privacy &amp; Cookie Policy
              </Link>
              .
            </span>
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-gold">{notice}</p>}
        <button type="submit" className="btn-primary" disabled={submitting || (mode === "signup" && !agreedToTerms)}>
          {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setNotice(null);
        }}
        className="text-sm text-muted hover:text-foreground text-center"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
