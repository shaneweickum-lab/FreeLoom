"use client";

import Tabs from "@/components/Tabs";
import AccountTab from "@/components/settings/AccountTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import NotificationsTab from "@/components/settings/NotificationsTab";
import BillingTab from "@/components/settings/BillingTab";
import AboutTab from "@/components/settings/AboutTab";
import type { SchoolProfile } from "@/lib/types";
import type { PriceTable } from "@/lib/billing/prices";

export default function SettingsTabs({
  userId,
  initialProfile,
  isAdmin,
  prices,
}: {
  userId: string;
  initialProfile: SchoolProfile | null;
  isAdmin: boolean;
  prices: PriceTable;
}) {
  return (
    <Tabs
      tabs={[
        {
          id: "account",
          label: "Account",
          content: <AccountTab userId={userId} initialProfile={initialProfile} isAdmin={isAdmin} />,
        },
        { id: "appearance", label: "Appearance", content: <AppearanceTab /> },
        {
          id: "notifications",
          label: "Notifications",
          content: <NotificationsTab userId={userId} initialProfile={initialProfile} isAdmin={isAdmin} />,
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
