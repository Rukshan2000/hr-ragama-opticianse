import { Suspense } from "react";
import { ResetPasswordForm } from "@/features/auth/password-reset-forms";

export const metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
