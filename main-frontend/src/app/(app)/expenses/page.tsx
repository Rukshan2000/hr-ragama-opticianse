"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { ExpensesPage } from "@/features/hr/admin";

export default function Page() {
  return (<RequirePermission permission="expenses:read" context="tenant">
      <ExpensesPage />
    </RequirePermission>);
}
