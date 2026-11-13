"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { holidaysConfig } from "@/features/hr/configs";
import { CrudPage } from "@/features/hr/kit";

export default function Page() {
  return (
    <RequirePermission permission="organization:read" context="tenant">
      <CrudPage config={holidaysConfig} />
    </RequirePermission>
  );
}
