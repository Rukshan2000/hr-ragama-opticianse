"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { TrainingPage } from "@/features/hr/talent";

export default function Page() {
  return (<RequirePermission permission="training:read" context="tenant">
      <TrainingPage />
    </RequirePermission>);
}
