"use client";

import { useSearchParams } from "next/navigation";
import Tabs from "@/components/Tabs";
import AccountTab from "@/components/settings/AccountTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import NotificationsTab from "@/components/settings/NotificationsTab";
import AcademicTab from "@/components/settings/AcademicTab";
import BillingTab from "@/components/settings/BillingTab";
import HouseholdTab from "@/components/settings/HouseholdTab";
import AboutTab from "@/components/settings/AboutTab";
import type { SchoolProfile } from "@/lib/types";
import type { PriceTable } from "@/lib/billing/prices";

export default function SettingsTabs({
  userId,
  isOwner,
  initialProfile,
  isAdmin,
  prices,
  authEmail,
}: {
  /** The household's owner id -- every tab's writes to school_profiles are
   * keyed to this, not necessarily the signed-in user's own id (see
   * household.ts). */
  userId: string;
  /** Whether the signed-in user is the literal owner vs. an accepted
   * guardian -- gates billing/account-deletion, which stay owner-only even
   * though everything else here is shared. */
  isOwner: boolean;
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
          content: (
            <AccountTab userId={userId} isOwner={isOwner} initialProfile={initialProfile} isAdmin={isAdmin} authEmail={authEmail} />
          ),
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
          id: "household",
          label: "Household",
          content: <HouseholdTab userId={userId} isOwner={isOwner} />,
        },
        ...(isOwner
          ? [
              {
                id: "billing",
                label: "Billing",
                content: <BillingTab userId={userId} initialProfile={initialProfile} isAdmin={isAdmin} prices={prices} />,
              },
            ]
          : []),
        { id: "about", label: "About", content: <AboutTab /> },
      ]}
    />
  );
}
