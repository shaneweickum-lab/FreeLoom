"use client";

import Tabs from "@/components/Tabs";
import AccountTab from "@/components/settings/AccountTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import NotificationsTab from "@/components/settings/NotificationsTab";
import BillingTab from "@/components/settings/BillingTab";
import AboutTab from "@/components/settings/AboutTab";
import type { SchoolProfile } from "@/lib/types";

export default function SettingsTabs({ userId, initialProfile }: { userId: string; initialProfile: SchoolProfile | null }) {
  return (
    <Tabs
      tabs={[
        { id: "account", label: "Account", content: <AccountTab userId={userId} initialProfile={initialProfile} /> },
        { id: "appearance", label: "Appearance", content: <AppearanceTab /> },
        {
          id: "notifications",
          label: "Notifications",
          content: <NotificationsTab userId={userId} initialProfile={initialProfile} />,
        },
        { id: "billing", label: "Billing", content: <BillingTab userId={userId} initialProfile={initialProfile} /> },
        { id: "about", label: "About", content: <AboutTab /> },
      ]}
    />
  );
}
