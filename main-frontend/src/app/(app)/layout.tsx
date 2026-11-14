import { AppShell } from "@/components/layout/app-shell";

// AppShell renders a splash until the client-side session loads, so pages can't be prerendered
// for instant-navigation validation. Auth-gated app: opt out.
export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
