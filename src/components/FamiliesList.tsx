"use client";

import Link from "next/link";
import { useState } from "react";
import type { SchoolingType } from "@/lib/types";

export type FamilyRow = {
  userId: string;
  email: string;
  parentName: string | null;
  schoolingType: SchoolingType | null;
};

const SCHOOLING_TYPE_LABEL: Record<SchoolingType, string> = {
  homeschooling: "Homeschooling",
  unschooling: "Unschooling",
  wildschooling: "Wildschooling",
};

/** Every signed-up account, not just admins or waitlist signups -- click a
 * row to message them, request read-only access, or send them a
 * personalized announcement from /admin/users/[userId]. */
export default function FamiliesList({ families }: { families: FamilyRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? families.filter((f) => `${f.email} ${f.parentName ?? ""}`.toLowerCase().includes(q)) : families;

  return (
    <div className="flex flex-col gap-3">
      <input
        className="input sm:w-72"
        placeholder="Search by email or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="rounded-lg border border-navy-line overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-navy-soft text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Schooling</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.userId} className="border-t border-navy-line hover:bg-surface-hover">
                <td className="px-4 py-2">
                  <Link href={`/admin/users/${f.userId}`} className="text-gold hover:underline font-mono">
                    {f.email}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted">{f.parentName ?? "—"}</td>
                <td className="px-4 py-2 text-muted">
                  {f.schoolingType ? SCHOOLING_TYPE_LABEL[f.schoolingType] : "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-muted text-xs">
                  No matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
