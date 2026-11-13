"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { AnnouncementsPage } from "@/features/hr/admin";

export default function Page() {
  return (<RequirePermission permission="announcements:manage" context="tenant">
      <AnnouncementsPage />
    </RequirePermission>);
}
