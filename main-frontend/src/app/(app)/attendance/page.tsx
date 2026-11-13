"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { AttendancePage } from "@/features/hr/time";

export default function Page() {
  return (<RequirePermission permission="attendance:read" context="tenant">
      <AttendancePage />
    </RequirePermission>);
}
