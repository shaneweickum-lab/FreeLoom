"use client";

import { StudentProvider } from "@/lib/studentContext";
import StudentSwitcher from "@/components/StudentSwitcher";
import AssistantDrawer from "@/components/AssistantDrawer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudentProvider>
      <div className="flex flex-col gap-6">
        <StudentSwitcher />
        {children}
      </div>
      <AssistantDrawer />
    </StudentProvider>
  );
}
