"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/lib/studentContext";
import { resolveStateName } from "@/lib/usStates";
import type { StateRegulation } from "@/lib/types";

export default function SettingsPage() {
  const { currentStudent } = useStudents();
  const [stateRegulation, setStateRegulation] = useState<StateRegulation | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const stateName = resolveStateName(currentStudent?.state ?? null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStateRegulation(null);
    setChecked(false);
    if (!stateName) {
      setChecked(true);
      return;
    }
    const supabase = createClient();
    supabase
      .from("state_regulations")
      .select("*")
      .eq("state", stateName)
      .maybeSingle()
      .then(({ data }) => {
        setStateRegulation(data);
        setChecked(true);
      });
  }, [currentStudent]);

  if (!currentStudent) {
    return <p className="text-muted text-sm">Add a child from the dashboard first.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-muted text-sm">Account and compliance settings for {currentStudent.name}.</p>
      </div>

      {checked && (
        <div className="rounded-lg border border-border bg-surface shadow-sm p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-sm">State requirements</h2>
          {!resolveStateName(currentStudent.state) ? (
            <p className="text-sm text-muted">
              Set {currentStudent.name}&apos;s state on the Dashboard to see homeschool requirements for it here.
            </p>
          ) : !stateRegulation ? (
            <p className="text-sm text-muted">
              We don&apos;t have {resolveStateName(currentStudent.state)}&apos;s requirements loaded yet.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2 text-sm">
                <li>
                  <span className="font-medium">Compulsory attendance: </span>
                  <span className="text-muted">{stateRegulation.compulsory_attendance ?? "Not specified"}</span>
                </li>
                <li>
                  <span className="font-medium">Required subjects: </span>
                  <span className="text-muted">
                    {stateRegulation.required_subjects?.length ? stateRegulation.required_subjects.join(", ") : "None mandated"}
                  </span>
                </li>
                <li>
                  <span className="font-medium">Instructional time: </span>
                  <span className="text-muted">
                    {stateRegulation.instructional_hours?.days || stateRegulation.instructional_hours?.hours
                      ? [
                          stateRegulation.instructional_hours.days ? `${stateRegulation.instructional_hours.days} days` : null,
                          stateRegulation.instructional_hours.hours ? `${stateRegulation.instructional_hours.hours} hours` : null,
                        ]
                          .filter(Boolean)
                          .join(" / ")
                      : "Not specified"}
                  </span>
                </li>
                <li>
                  <span className="font-medium">Reporting: </span>
                  <span className="text-muted">{stateRegulation.reporting_requirements ?? "Not specified"}</span>
                </li>
                <li>
                  <span className="font-medium">Testing/evaluation: </span>
                  <span className="text-muted">{stateRegulation.testing_requirements ?? "Not specified"}</span>
                </li>
              </ul>
              <p className="text-xs text-muted border-t border-border pt-2">
                Last verified {stateRegulation.last_verified_date ?? "unknown"} —{" "}
                {stateRegulation.source_url ? (
                  <a href={stateRegulation.source_url} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                    verify against the source
                  </a>
                ) : (
                  "source not recorded"
                )}
                . Homeschool law changes — always confirm anything time-sensitive yourself before relying on it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
