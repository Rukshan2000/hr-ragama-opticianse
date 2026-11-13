"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { leavePoliciesConfig } from "@/features/hr/configs";
import { CrudPage } from "@/features/hr/kit";

export default function Page() {
  return (
    <RequirePermission permission="leave:read" context="tenant">
      <CrudPage config={leavePoliciesConfig} />
    </RequirePermission>
  );
}
