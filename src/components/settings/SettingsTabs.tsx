"use client";

import { useSearchParams } from "next/navigation";
import Tabs from "@/components/Tabs";
import AccountTab from "@/components/settings/AccountTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import NotificationsTab from "@/components/settings/NotificationsTab";
import AcademicTab from "@/components/settings/AcademicTab";
import BillingTab from "@/components/settings/BillingTab";
import AboutTab from "@/components/settings/AboutTab";
import type { SchoolProfile } from "@/lib/types";
import type { PriceTable } from "@/lib/billing/prices";

export default function SettingsTabs({
  userId,
  initialProfile,
  isAdmin,
  prices,
  authEmail,
}: {
  userId: string;
  initialProfile: SchoolProfile | null;
  isAdmin: boolean;
  prices: PriceTable;
  authEmail: string | null;
}) {
  const searchParams = useSearchParams();
  return (
    <Tabs
      initialTabId={searchParams.get("tab") ?? undefined}
      tabs={[
        {
          id: "account",
          label: "Account",
          content: <AccountTab userId={userId} initialProfile={initialProfile} isAdmin={isAdmin} authEmail={authEmail} />,
        },
        { id: "appearance", label: "Appearance", content: <AppearanceTab /> },
        {
          id: "notifications",
          label: "Notifications",
          content: <NotificationsTab userId={userId} initialProfile={initialProfile} isAdmin={isAdmin} />,
        },
        {
          id: "academic",
          label: "Academic",
          content: <AcademicTab userId={userId} initialProfile={initialProfile} />,
        },
        {
          id: "billing",
          label: "Billing",
          content: <BillingTab userId={userId} initialProfile={initialProfile} isAdmin={isAdmin} prices={prices} />,
        },
        { id: "about", label: "About", content: <AboutTab /> },
      ]}
    />
  );
}
