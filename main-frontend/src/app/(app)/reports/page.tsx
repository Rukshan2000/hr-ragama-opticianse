"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { ReportsPage } from "@/features/hr/admin";

export default function Page() {
  return (<RequirePermission permission="reports:read" context="tenant">
      <ReportsPage />
    </RequirePermission>);
}
