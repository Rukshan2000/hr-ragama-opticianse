"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { ContractsPage } from "@/features/hr/people";

export default function Page() {
  return (<RequirePermission permission="contracts:read" context="tenant">
      <ContractsPage />
    </RequirePermission>);
}
