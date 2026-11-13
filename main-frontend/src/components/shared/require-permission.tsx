"use client";

import { Building2, Lock } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { PageContainer } from "./page";
import { EmptyState } from "./states";

/** UI-level gate so users don't land on pages that will only 403. The backend still enforces it. */
export function RequirePermission({
  permission,
  context,
  children,
}: {
  permission: string;
  context?: "tenant" | "platform";
  children: React.ReactNode;
}) {
  const { can, inTenant } = useSession();
  const wrongContext = context && (context === "tenant") !== inTenant;
  if (wrongContext || !can(permission)) {
    return (
      <PageContainer>
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={wrongContext && context === "tenant" ? Building2 : Lock}
            title={wrongContext ? (context === "tenant" ? "Select an organization" : "Platform area") : "You don't have access"}
            description={
              wrongContext
                ? context === "tenant"
                  ? "This page manages an organization. Switch to one from the sidebar."
                  : "This page is only available in the platform administration context."
                : `This page requires the “${permission}” permission. Ask an administrator if you need it.`
            }
            action={
              <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Back to dashboard
              </Link>
            }
          />
        </div>
      </PageContainer>
    );
  }
  return children;
}
