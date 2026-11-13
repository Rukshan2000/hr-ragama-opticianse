"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { OnboardingPage } from "@/features/hr/people";

export default function Page() {
  return (<RequirePermission permission="employees:read" context="tenant">
      <OnboardingPage />
    </RequirePermission>);
}
