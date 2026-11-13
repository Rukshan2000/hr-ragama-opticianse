import { Suspense } from "react";
import { RequirePermission } from "@/components/shared/require-permission";
import { EmployeesPage } from "@/features/employees/employees-page";

export const metadata = { title: "Employees" };

export default function Page() {
  return (
    <RequirePermission permission="employees:read" context="tenant">
      <Suspense>
        <EmployeesPage />
      </Suspense>
    </RequirePermission>
  );
}
