export type PasswordStrength = "weak" | "good" | "strong";

/** A small, deliberately non-exhaustive set of the most common real-world
 * passwords -- catches the handful of cases the character-variety scoring
 * below wouldn't (e.g. "password1" scores decently on variety alone). Not
 * meant to replace a real breached-password list, just a cheap first
 * filter that doesn't require a network call or a bundled wordlist. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "123456", "12345678", "123456789",
  "1234567890", "qwerty", "qwerty123", "letmein", "111111", "iloveyou",
  "admin123", "welcome", "welcome1", "monkey123", "dragon123", "football",
  "abc123", "sunshine", "princess", "freeloom", "freeloom1",
]);

/** Deliberately a simple heuristic (length + character-class variety, with
 * a common-password/low-variety penalty) rather than a full entropy
 * estimator -- avoids pulling in a library like zxcvbn (a sizeable bundle)
 * for what's meant as a first line of defense against the most obviously
 * weak passwords, not a rigorous strength audit. */
export function scorePassword(password: string): { strength: PasswordStrength; score: number } {
  if (!password) return { strength: "weak", score: 0 };
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return { strength: "weak", score: 0 };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  // A long run of the same/few characters (e.g. "aaaaaaaaaaaa") scores well
  // on length alone despite being trivially guessable -- cap it.
  const uniqueChars = new Set(password.toLowerCase()).size;
  if (uniqueChars < 4) score = Math.min(score, 2);

  if (score <= 3) return { strength: "weak", score };
  if (score <= 5) return { strength: "good", score };
  return { strength: "strong", score };
}

/** The bar signup actually enforces -- "weak" blocks submission, "good" and
 * "strong" are both accepted. Kept separate from scorePassword() so the
 * threshold can move without touching the scoring logic itself. */
export function meetsMinimumStrength(password: string): boolean {
  return scorePassword(password).strength !== "weak";
}
