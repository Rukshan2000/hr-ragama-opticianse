"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { AssetsPage } from "@/features/hr/admin";

export default function Page() {
  return (<RequirePermission permission="assets:read" context="tenant">
      <AssetsPage />
    </RequirePermission>);
}
