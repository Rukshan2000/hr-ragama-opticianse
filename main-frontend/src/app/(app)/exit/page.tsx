"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { ExitPage } from "@/features/hr/people";

export default function Page() {
  return (<RequirePermission permission="exit:read" context="tenant">
      <ExitPage />
    </RequirePermission>);
}
