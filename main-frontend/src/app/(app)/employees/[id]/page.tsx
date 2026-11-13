import { RequirePermission } from "@/components/shared/require-permission";
import { EmployeeDetail } from "@/features/employees/employee-detail";

export const metadata = { title: "Employee" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="employees:read" context="tenant">
      <EmployeeDetail id={id} />
    </RequirePermission>
  );
}
