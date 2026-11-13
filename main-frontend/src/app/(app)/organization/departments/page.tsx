"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { departmentsConfig } from "@/features/organization/configs";
import { MasterDataPage } from "@/features/organization/master-data-page";

export default function Page() {
  return (
    <RequirePermission permission="organization:read" context="tenant">
      <MasterDataPage config={departmentsConfig} />
    </RequirePermission>
  );
}
