"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { HrSettingsPage } from "@/features/hr/admin";

export default function Page() {
  return (<RequirePermission permission="self:access" context="tenant">
      <HrSettingsPage />
    </RequirePermission>);
}
