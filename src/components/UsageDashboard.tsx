"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatBytes } from "@/lib/formatBytes";

type Meter = {
  label: string;
  usedBytes: number;
  limitBytes: number;
};

function meterColor(fraction: number): string {
  if (fraction >= 0.85) return "bg-red-400";
  if (fraction >= 0.6) return "bg-gold";
  return "bg-emerald-400";
}

function UsageMeter({ meter }: { meter: Meter }) {
  const fraction = meter.limitBytes > 0 ? Math.min(meter.usedBytes / meter.limitBytes, 1) : 0;
  const percent = Math.round(fraction * 100);
  const overLimit = meter.usedBytes > meter.limitBytes;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-navy-line bg-navy-soft p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{meter.label}</span>
        <span className={`font-mono text-xs ${overLimit ? "text-red-400" : "text-muted"}`}>{percent}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-navy-deep/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${meterColor(fraction)}`}
          style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="text-xs text-muted font-mono">
        {formatBytes(meter.usedBytes)} <span className="text-muted/60">of</span> {formatBytes(meter.limitBytes)}
        {overLimit && <span className="text-red-400"> — over limit</span>}
      </p>
    </div>
  );
}

/** Live Supabase database + storage size vs. this project's plan limits
 * (configurable via SUPABASE_DB_LIMIT_GB / SUPABASE_STORAGE_LIMIT_GB env
 * vars -- bump them after a plan upgrade). Data is fetched server-side by
 * the /admin page via the admin_db_usage() RPC; this component just renders
 * it and offers a refresh, since a Server Component page can't poll on its
 * own. Vercel usage isn't included here -- see the conversation this was
 * built from: Vercel doesn't expose a clean usage-vs-limit API to automate
 * the way Supabase's own SQL functions do, so that side stays manual. */
export default function UsageDashboard({
  error,
  dbSizeBytes,
  storageSizeBytes,
  dbLimitBytes,
  storageLimitBytes,
  computedAt,
}: {
  error?: string;
  dbSizeBytes: number;
  storageSizeBytes: number;
  dbLimitBytes: number;
  storageLimitBytes: number;
  computedAt: string | null;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  }

  if (error) {
    return <p className="text-sm text-red-400">Couldn&apos;t load usage: {error}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-muted text-sm">
          Live database and storage size, so you know when it&apos;s time to upgrade the Supabase plan.
        </p>
        <button onClick={refresh} disabled={refreshing} className="btn-secondary text-xs whitespace-nowrap">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <UsageMeter meter={{ label: "Database size", usedBytes: dbSizeBytes, limitBytes: dbLimitBytes }} />
        <UsageMeter meter={{ label: "Storage size", usedBytes: storageSizeBytes, limitBytes: storageLimitBytes }} />
      </div>

      {computedAt && (
        <p className="text-[10px] text-muted/70">
          Last measured {new Date(computedAt).toLocaleString()}. Vercel usage isn&apos;t tracked here yet — it
          doesn&apos;t expose a comparable live API, so keep an eye on that side from the Vercel dashboard directly.
        </p>
      )}
    </div>
  );
}
