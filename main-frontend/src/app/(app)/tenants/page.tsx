import { Suspense } from "react";
import { RequirePermission } from "@/components/shared/require-permission";
import { TenantsPage } from "@/features/tenants/tenants-page";

export const metadata = { title: "Tenants" };

export default function Page() {
  return (
    <RequirePermission permission="tenants:read" context="platform">
      <Suspense>
        <TenantsPage />
      </Suspense>
    </RequirePermission>
  );
}
