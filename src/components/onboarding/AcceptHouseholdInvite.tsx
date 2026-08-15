"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LogoMark from "@/components/LogoMark";
import { cardClassName } from "@/components/ui/Card";

/**
 * Shown instead of the normal "set up your school" wizard when the signed-in
 * account has a pending household invite matching its email -- accepting
 * joins an existing household (full access to its students/entries/
 * transcripts) rather than starting a new one from scratch.
 */
export default function AcceptHouseholdInvite({ ownerName }: { ownerName: string | null }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept() {
    setAccepting(true);
    setError("");
    try {
      const res = await fetch("/api/household/accept", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't accept that invite -- try again.");
        setAccepting(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Couldn't reach the server -- try again.");
      setAccepting(false);
    }
  }

  return (
    <div className={`flex flex-col gap-4 items-start ${cardClassName()}`}>
      <LogoMark size={40} />
      <div>
        <h1 className="font-serif text-xl font-bold">You&apos;ve been invited</h1>
        <p className="text-muted text-sm mt-1">
          {ownerName ? `${ownerName} has` : "Someone has"} invited you as a second guardian on their FreeLoom household
          -- you&apos;ll be able to log activities, review entries, and generate transcripts for their students, the
          same as they can.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={handleAccept} disabled={accepting} className="btn-primary text-sm">
        {accepting ? "Joining…" : "Accept and join"}
      </button>
    </div>
  );
}
