"use client";

import { RequirePermission } from "@/components/shared/require-permission";
import { DocumentsPage } from "@/features/hr/people";

export default function Page() {
  return (<RequirePermission permission="documents:read" context="tenant">
      <DocumentsPage />
    </RequirePermission>);
}
