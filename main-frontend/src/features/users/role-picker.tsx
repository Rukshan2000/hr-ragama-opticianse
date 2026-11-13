"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { Role } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export function RolePicker({ roles, value, onChange, disabled }: { roles: Role[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((r) => {
        const checked = value.includes(r.id);
        return (
          <label
            key={r.id}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-subtle/50",
              checked && "border-brand-accent/40 bg-subtle/60",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(c) => onChange(c ? [...value, r.id] : value.filter((id) => id !== r.id))}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{r.name}</span>
              <span className="block text-xs text-muted-foreground">{r.permissions.length} permissions</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
