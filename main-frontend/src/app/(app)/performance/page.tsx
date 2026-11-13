"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { PerformancePage } from "@/features/hr/talent";

export default function Page() {
  return (<RequirePermission permission="performance:read" context="tenant">
      <PerformancePage />
    </RequirePermission>);
}
