import { Suspense } from "react";
import { SelectOrganization } from "@/features/auth/select-organization";

export const metadata = { title: "Choose organization" };

export default function SelectOrganizationPage() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-md">
        <Suspense>
          <SelectOrganization />
        </Suspense>
      </div>
    </div>
  );
}
