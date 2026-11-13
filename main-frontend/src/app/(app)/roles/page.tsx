import { RequirePermission } from "@/components/shared/require-permission";
import { RolesPage } from "@/features/roles/roles-page";

export const metadata = { title: "Roles" };

export default function Page() {
  return (
    <RequirePermission permission="roles:read" context="tenant">
      <RolesPage />
    </RequirePermission>
  );
}
