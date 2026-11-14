"use client";

import {
  ChevronRight,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { findNavItem } from "@/config/navigation";
import { useLogout } from "@/features/auth/use-auth-actions";
import { useSession } from "@/hooks/use-session";
import { NotificationsBell } from "@/features/hr/workflow";
import { SidebarContent } from "./app-sidebar";
import { AppSwitcher } from "./app-switcher";

export function Breadcrumbs() {
  const pathname = usePathname();
  const { me } = useSession();
  const item = findNavItem(pathname);
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-[13px]"
    >
      <span className="truncate text-muted-foreground">
        {me?.tenant?.name ?? "Platform"}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-text-muted" />
      <span className="truncate font-medium" aria-current="page">
        {item?.title ?? "Dashboard"}
      </span>
    </nav>
  );
}

/** Searches the main collection the current user can access (users in a tenant, tenants on the platform). */
function GlobalSearch() {
  const { can, inTenant } = useSession();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const target =
    inTenant && can("users:read")
      ? "/users"
      : !inTenant && can("tenants:read")
        ? "/tenants"
        : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!target) return null;
  return (
    <form
      role="search"
      className="relative hidden w-full max-w-xs md:block"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`${target}?search=${encodeURIComponent(q.trim())}`);
        setQ("");
        ref.current?.blur();
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={100}
        placeholder={target === "/users" ? "Search users…" : "Search tenants…"}
        aria-label="Search"
        className="h-9 w-full rounded-[10px] border bg-subtle/50 pr-12 pl-9 text-[13px] outline-none transition-colors placeholder:text-text-muted focus:border-ring focus:bg-card focus:ring-3 focus:ring-ring/20"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md border bg-card px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
        ⌘K
      </kbd>
    </form>
  );
}

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" aria-label="Change theme" />
        }
      >
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 rounded-xl p-1.5">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            className="rounded-lg px-2 py-1.5"
            onClick={() => setTheme(o.value)}
            data-active={theme === o.value || undefined}
          >
            <o.icon /> {o.label}
            {theme === o.value && (
              <span className="ml-auto size-1.5 rounded-full bg-brand-accent" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileMenu() {
  const { me } = useSession();
  const logout = useLogout();
  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            className="rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        }
      >
        <UserAvatar name={me.name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <span className="block truncate text-[13px] font-medium text-foreground">
              {me.name}
            </span>
            <span className="block truncate text-xs font-normal">
              {me.email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="rounded-lg px-2 py-1.5"
          render={<Link href="/settings" />}
        >
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          className="rounded-lg px-2 py-1.5"
          onClick={() => logout.mutate()}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 rounded-b-2xl bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70 lg:top-3 lg:h-14 lg:rounded-2xl lg:border lg:bg-card lg:px-3">
      <Button
        variant="outline"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        onClick={() => setMobileOpen(true)}
      >
        <Menu />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <GlobalSearch />
      <NotificationsBell />
      <AppSwitcher />
      <ThemeSwitcher />
      <ProfileMenu />
    </header>
  );
}
