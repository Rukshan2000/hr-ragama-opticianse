"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { PayslipsPage } from "@/features/hr/payroll";

export default function Page() {
  return (<RequirePermission permission="payroll:read" context="tenant">
      <PayslipsPage />
    </RequirePermission>);
}
