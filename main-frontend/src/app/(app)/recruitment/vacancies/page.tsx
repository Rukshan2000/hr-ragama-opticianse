"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { VacanciesPage } from "@/features/hr/talent";

export default function Page() {
  return (<RequirePermission permission="recruitment:read" context="tenant">
      <VacanciesPage />
    </RequirePermission>);
}
