"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { LeaveCalendarPage } from "@/features/hr/time";

export default function Page() {
  return (<RequirePermission permission="leave:read" context="tenant">
      <LeaveCalendarPage />
    </RequirePermission>);
}
