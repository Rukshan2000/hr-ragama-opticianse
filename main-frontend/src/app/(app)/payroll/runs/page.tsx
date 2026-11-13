"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { PayrollRunsPage } from "@/features/hr/payroll";

export default function Page() {
  return (<RequirePermission permission="payroll:read" context="tenant">
      <PayrollRunsPage />
    </RequirePermission>);
}
