import { RegisterForm } from "@/features/auth/register-form";

import { SINGLE_TENANT } from "@/config/tenancy";

export const metadata = {
  title: SINGLE_TENANT ? "Create account" : "Create organization",
};

export default function RegisterPage() {
  return <RegisterForm />;
}
