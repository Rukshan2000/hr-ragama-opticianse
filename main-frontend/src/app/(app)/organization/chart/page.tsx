import { RequirePermission } from "@/components/shared/require-permission";
import { OrgChartPage } from "@/features/organization/org-chart";

export const metadata = { title: "Organization Chart" };

export default function Page() {
  return (
    <RequirePermission permission="organization:read" context="tenant">
      <OrgChartPage />
    </RequirePermission>
  );
}
