"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { SalariesPage } from "@/features/hr/payroll";

export default function Page() {
  return (<RequirePermission permission="payroll:read" context="tenant">
      <SalariesPage />
    </RequirePermission>);
}
