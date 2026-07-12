"use client";

import { StudentProvider } from "@/lib/studentContext";
import { PlanProvider } from "@/lib/planContext";
import StudentSwitcher from "@/components/StudentSwitcher";
import AssistantDrawer from "@/components/AssistantDrawer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentProvider>
      <PlanProvider>
        <div className="flex flex-col gap-6">
          <StudentSwitcher />
          {children}
        </div>
        <AssistantDrawer />
      </PlanProvider>
    </StudentProvider>
  );
}
