"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { ApplicantsPage } from "@/features/hr/talent";

export default function Page() {
  return (<RequirePermission permission="recruitment:read" context="tenant">
      <ApplicantsPage />
    </RequirePermission>);
}
