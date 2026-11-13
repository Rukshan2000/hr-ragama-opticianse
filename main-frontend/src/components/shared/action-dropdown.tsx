"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ActionItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  hidden?: boolean;
}

/** Row action menu. Renders nothing when every action is hidden (permission-aware). */
export function ActionDropdown({ items, label = "Actions" }: { items: ActionItem[]; label?: string }) {
  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;
  const safe = visible.filter((i) => !i.destructive);
  const danger = visible.filter((i) => i.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={(e) => e.stopPropagation()} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
        {safe.map((i) => (
          <DropdownMenuItem key={i.label} onClick={i.onSelect} className="rounded-lg px-2 py-1.5">
            <i.icon /> {i.label}
          </DropdownMenuItem>
        ))}
        {safe.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map((i) => (
          <DropdownMenuItem key={i.label} variant="destructive" onClick={i.onSelect} className="rounded-lg px-2 py-1.5">
            <i.icon /> {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
