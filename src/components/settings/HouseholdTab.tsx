"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { HouseholdMember } from "@/lib/household";
import Card from "@/components/ui/Card";

/** Owner-managed guardian list + invite form, or (for an accepted guardian
 * viewing their own settings) a simple note that they're part of someone
 * else's household -- billing and account deletion stay owner-only
 * regardless (see household.ts's own doc comment for why), so there's
 * nothing for a guardian to manage here beyond seeing that it's shared. */
export default function HouseholdTab({ userId, isOwner }: { userId: string; isOwner: boolean }) {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("household_members")
      .select("*")
      .eq("owner_user_id", userId)
      .neq("status", "revoked")
      .order("created_at", { ascending: true });
    setMembers((data as HouseholdMember[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOwner) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/household/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't send that invite -- try again.");
        setInviting(false);
        return;
      }
      setNotice(`Invited ${email.trim()}.`);
      setEmail("");
      await load();
    } catch {
      setError("Couldn't reach the server -- try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string) {
    setRemovingId(memberId);
    try {
      await fetch("/api/household/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      await load();
    } finally {
      setRemovingId(null);
    }
  }

  if (!isOwner) {
    return (
      <Card variant="flat" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Household</h2>
        <p className="text-sm text-muted">
          You&apos;re a guardian on someone else&apos;s FreeLoom household -- you can log activities, review entries,
          and generate transcripts the same as they can. Billing and account deletion stay with the original owner.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="flat" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Invite a second guardian</h2>
        <p className="text-xs text-muted">
          Gives another adult full access to log and manage this household&apos;s students -- everything except
          billing and account deletion, which stay with you.
        </p>
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="email"
            required
            placeholder="their@email.com"
            className="input flex-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={inviting} className="btn-primary text-sm shrink-0">
            {inviting ? "Sending…" : "Invite"}
          </button>
        </form>
        {notice && <p className="text-xs text-gold">{notice}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </Card>

      <Card variant="flat" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Guardians</h2>
        {loading && <p className="text-xs text-muted">Loading…</p>}
        {!loading && members.length === 0 && <p className="text-xs text-muted">Just you so far.</p>}
        {!loading &&
          members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <span>{member.invited_email}</span>
                <span className="text-xs text-muted ml-2">{member.status === "accepted" ? "Active" : "Invited"}</span>
              </div>
              <button
                onClick={() => handleRemove(member.id)}
                disabled={removingId === member.id}
                className="text-xs text-muted hover:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
      </Card>
    </div>
  );
}
