"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { SchedulesPage } from "@/features/hr/time";

export default function Page() {
  return (<RequirePermission permission="organization:read" context="tenant">
      <SchedulesPage />
    </RequirePermission>);
}
