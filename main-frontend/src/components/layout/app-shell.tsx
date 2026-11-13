"use client";

import { useState } from "react";
import { BrandMark } from "@/components/layout/brand";
import { ErrorState } from "@/components/shared/states";
import { useSession } from "@/hooks/use-session";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";

const COLLAPSE_KEY = "sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, isPending, error, refetch } = useSession();
  // Safe to read during render: the shell shows a splash until the session loads, so the
  // sidebar is never part of server-rendered/hydrated markup.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        localStorage.getItem(COLLAPSE_KEY) === "1"
      );
    } catch {
      return false;
    }
  });

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });

  if (isPending) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <BrandMark className="animate-pulse" />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <div className="w-full max-w-md rounded-xl border bg-card">
          <ErrorState
            message={error?.message ?? "Unable to load your session."}
            onRetry={() => refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh gap-3 px-3 lg:py-3">
      <AppSidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <AppHeader />
        <main className="flex-1 pb-8 lg:px-3">{children}</main>
      </div>
    </div>
  );
}
