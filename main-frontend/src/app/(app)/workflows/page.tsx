"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { WorkflowsPage } from "@/features/hr/workflow";

export default function Page() {
  return (<RequirePermission permission="workflows:manage" context="tenant">
      <WorkflowsPage />
    </RequirePermission>);
}
