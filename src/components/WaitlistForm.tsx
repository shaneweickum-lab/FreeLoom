"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return <p className="text-sm text-gold font-medium">You&apos;re on the list — we&apos;ll email you when we launch.</p>;
  }

  return (
    <div className="flex flex-col gap-2 w-full sm:w-auto">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={status === "loading"}
          className="input sm:w-64"
        />
        <button type="submit" disabled={status === "loading"} className="btn-primary whitespace-nowrap">
          {status === "loading" ? "Joining…" : "Join the waitlist"}
        </button>
      </form>
      {status === "error" && <p className="text-xs text-red-400">{errorMessage}</p>}
    </div>
  );
}
