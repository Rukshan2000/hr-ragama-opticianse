import { Suspense } from "react";
import { RequirePermission } from "@/components/shared/require-permission";
import { UsersPage } from "@/features/users/users-page";

export const metadata = { title: "Users" };

export default function Page() {
  return (
    <RequirePermission permission="users:read" context="tenant">
      <Suspense>
        <UsersPage />
      </Suspense>
    </RequirePermission>
  );
}
