"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { PayrollPoliciesPage } from "@/features/hr/payroll";

export default function Page() {
  return (<RequirePermission permission="payroll:read" context="tenant">
      <PayrollPoliciesPage />
    </RequirePermission>);
}
