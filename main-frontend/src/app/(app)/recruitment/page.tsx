"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { RecruitmentPage } from "@/features/hr/talent";

export default function Page() {
  return (<RequirePermission permission="recruitment:read" context="tenant">
      <RecruitmentPage />
    </RequirePermission>);
}
