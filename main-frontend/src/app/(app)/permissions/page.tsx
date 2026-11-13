import { RequirePermission } from "@/components/shared/require-permission";
import { PermissionsPage } from "@/features/permissions/permissions-page";

export const metadata = { title: "Permissions" };

export default function Page() {
  return (
    <RequirePermission permission="permissions:read" context="tenant">
      <PermissionsPage />
    </RequirePermission>
  );
}
