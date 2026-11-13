"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { leaveTypesConfig } from "@/features/hr/configs";
import { CrudPage } from "@/features/hr/kit";

export default function Page() {
  return (
    <RequirePermission permission="leave:read" context="tenant">
      <CrudPage config={leaveTypesConfig} />
    </RequirePermission>
  );
}
