"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { MyWorkspace } from "@/features/hr/me";

export default function Page() {
  return (<RequirePermission permission="self:access" context="tenant">
      <MyWorkspace />
    </RequirePermission>);
}
