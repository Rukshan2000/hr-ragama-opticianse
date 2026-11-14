"use client";

import { useQuery } from "@tanstack/react-query";
import { AppWindow, Briefcase, Grid3x3, ShoppingCart, Users, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/** InvoHub address. Unset = no switcher, and sign-out stays local to this app. */
export const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL?.replace(/\/$/, "");
const SELF = process.env.NEXT_PUBLIC_HUB_APP_KEY;
const ICONS: Record<string, LucideIcon> = { users: Users, briefcase: Briefcase, cart: ShoppingCart };

interface CatalogApp {
  key: string;
  name: string;
  description: string;
  icon: string;
  status: "live" | "coming_soon";
}

/** 3×3 grid in the header: jump to another Invo app through the hub, already signed in. */
export function AppSwitcher() {
  const apps = useQuery({
    queryKey: ["hub", "apps"],
    queryFn: async () => (await (await fetch(`${HUB_URL}/.well-known/invo-apps.json`)).json()) as CatalogApp[],
    enabled: Boolean(HUB_URL),
    staleTime: 5 * 60_000,
  });
  if (!HUB_URL) return null;
  const live = (apps.data ?? []).filter((a) => a.status === "live" && a.key !== SELF);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Switch app" />}>
        <Grid3x3 />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">Invo apps</DropdownMenuLabel>
          {apps.isError && <p className="px-2 py-1.5 text-xs text-muted-foreground">Couldn&apos;t load apps.</p>}
          {live.map((a) => {
            const Icon = ICONS[a.icon] ?? AppWindow;
            return (
              <DropdownMenuItem
                key={a.key}
                className="rounded-lg px-2 py-1.5"
                render={<a href={`${HUB_URL}/launch/${encodeURIComponent(a.key)}`} />}
              >
                <Icon />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.description}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="rounded-lg px-2 py-1.5" render={<a href={HUB_URL} />}>
          <Grid3x3 /> All apps
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
