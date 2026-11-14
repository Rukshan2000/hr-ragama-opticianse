"use client";

import { SINGLE_TENANT } from "@/config/tenancy";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { findNavItem, visibleNavigation, type NavItem } from "@/config/navigation";
import { useLogout, useSwitchTenant } from "@/features/auth/use-auth-actions";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";

const isActive = (href: string, pathname: string) => findNavItem(pathname)?.href === href;

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActive(item.href, pathname);
  const ref = useRef<HTMLAnchorElement>(null);
  // Keep the current page visible in a long, scrolled sidebar.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const link = (
    <Link
      ref={ref}
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-brand-accent/12 font-semibold text-foreground ring-1 ring-brand-accent/25"
          : "text-muted-foreground hover:bg-subtle/60 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <item.icon
        className={cn("size-4 shrink-0", active && "text-brand-accent")}
      />
      {!collapsed && <span className="truncate">{item.title}</span>}
      {!collapsed && active && (
        <span
          className="ml-auto h-4 w-1 rounded-full bg-brand-secondary"
          aria-hidden
        />
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

function TenantSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me } = useSession();
  const switchTenant = useSwitchTenant();
  if (!me) return null;
  const current = me.tenant;
  if (me.tenants.length === 0 && !current) {
    return collapsed ? null : (
      <div className="flex h-11 items-center gap-2.5 rounded-xl border bg-subtle/50 px-3 text-[13px]">
        <Building2 className="size-4 text-brand-accent" />
        <span className="font-medium">Platform administration</span>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={switchTenant.isPending}
            className={cn(
              "flex h-11 w-full items-center gap-2.5 rounded-xl border bg-subtle/50 px-2.5 text-left transition-colors outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring/50",
              collapsed && "justify-center px-0",
            )}
          />
        }
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border bg-card text-[11px] font-semibold text-brand-accent">
          {(current?.name ?? "P")[0]!.toUpperCase()}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {current?.name ?? "No organization"}
              </span>
              <span className="block truncate text-[11px] text-text-muted">
                {current ? current.slug : "Platform context"}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-text-muted" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 text-xs">
            Organizations
          </DropdownMenuLabel>
          {me.tenants.map((t) => (
            <DropdownMenuItem
              key={t.id}
              className="rounded-lg px-2 py-1.5"
              onClick={() =>
                t.id !== current?.id && switchTenant.mutate(t.slug)
              }
            >
              <span className="grid size-6 place-items-center rounded-md border text-[10px] font-semibold">
                {t.name[0]!.toUpperCase()}
              </span>
              <span className="truncate">{t.name}</span>
              {t.id === current?.id && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavGroups({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { can, inTenant } = useSession();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = visibleNavigation(can, inTenant);
  // Navigating into a collapsed group opens it, so the current page is always shown.
  const pathname = usePathname();
  const activeGroup = groups.find((g) => g.items.some((i) => isActive(i.href, pathname)))?.title;
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (activeGroup && closed[activeGroup]) setClosed({ ...closed, [activeGroup]: false });
  }
  const allClosed = groups.every((g) => closed[g.title]);
  const setAll = (value: boolean) =>
    setClosed(Object.fromEntries(groups.map((g) => [g.title, value])));
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto" aria-label="Main">
      {!collapsed && (
        <div className="flex justify-end px-1">
          <button
            type="button"
            onClick={() => setAll(!allClosed)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-subtle/60 hover:text-foreground"
          >
            {allClosed ? (
              <ChevronsUpDown className="size-3.5" />
            ) : (
              <ChevronsDownUp className="size-3.5" />
            )}
            {allClosed ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.title} className="space-y-0.5">
          {!collapsed && (
            <button
              type="button"
              onClick={() =>
                setClosed((c) => ({ ...c, [g.title]: !c[g.title] }))
              }
              aria-expanded={!closed[g.title]}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase hover:text-muted-foreground"
            >
              {g.title}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  closed[g.title] && "-rotate-90",
                )}
              />
            </button>
          )}
          {(collapsed || !closed[g.title]) &&
            g.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
        </div>
      ))}
    </nav>
  );
}

function ProfileCard({ collapsed }: { collapsed: boolean }) {
  const { me } = useSession();
  const logout = useLogout();
  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl border bg-card p-2 text-left transition-colors outline-none hover:bg-subtle/60 focus-visible:ring-2 focus-visible:ring-ring/50",
              collapsed && "justify-center border-0 p-0",
            )}
          />
        }
      >
        <UserAvatar name={me.name} size="sm" />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {me.name}
            </span>
            <span className="block truncate text-[11px] text-text-muted">
              {me.roles.map((r) => r.name).join(", ") || me.email}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56 rounded-xl p-1.5"
      >
        <DropdownMenuItem
          className="rounded-lg px-2 py-1.5"
          render={<Link href="/settings" />}
        >
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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

/** Sidebar body, shared by the desktop rail and the mobile sheet. */
export function SidebarContent({
  collapsed = false,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div
        className={cn(
          "flex items-center justify-between px-1 pt-1",
          collapsed && "flex-col gap-3",
        )}
      >
        <Brand collapsed={collapsed} />
        {onToggle && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        )}
      </div>
      {!SINGLE_TENANT && <TenantSwitcher collapsed={collapsed} />}
      <NavGroups collapsed={collapsed} onNavigate={onNavigate} />
      <ProfileCard collapsed={collapsed} />
    </div>
  );
}

export function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        "sticky top-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 rounded-2xl border bg-sidebar transition-[width] duration-200 lg:block",
        collapsed ? "w-[68px]" : "w-64",
      )}
    >
      <SidebarContent collapsed={collapsed} onToggle={onToggle} />
    </aside>
  );
}
