"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/shared/form";
import { LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { applyFieldErrors } from "@/lib/api/client";
import type { Role } from "@/lib/api/types";
import { actionLabel, groupPermissions } from "./permission-groups";
import { useAssignablePermissions, useRoleMutations } from "./use-roles";

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(100),
  description: z.string().trim().max(255),
  permissions: z.array(z.string()),
});

function PermissionChecklist({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { permissions, isPending, isEnabled } = useAssignablePermissions(value);
  if (isEnabled && isPending) return <LoadingState rows={3} />;
  const set = new Set(value);
  return (
    <div className="space-y-3">
      {groupPermissions(permissions).map((g) => {
        const keys = g.permissions.map((p) => p.key);
        const all = keys.every((k) => set.has(k));
        const some = !all && keys.some((k) => set.has(k));
        return (
          <fieldset key={g.resource} className="rounded-xl border">
            <legend className="sr-only">{g.label}</legend>
            <label className="flex cursor-pointer items-center gap-2.5 border-b border-border-subtle bg-subtle/50 px-3 py-2.5 first:rounded-t-xl">
              <Checkbox
                checked={all}
                indeterminate={some}
                disabled={disabled}
                onCheckedChange={(c) => onChange(c ? [...new Set([...value, ...keys])] : value.filter((k) => !keys.includes(k)))}
              />
              <span className="text-[13px] font-semibold">{g.label}</span>
              <span className="ml-auto text-xs text-text-muted tabular-nums">
                {keys.filter((k) => set.has(k)).length}/{keys.length}
              </span>
            </label>
            <div className="divide-y divide-border-subtle">
              {g.permissions.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-subtle/30">
                  <Checkbox
                    className="mt-0.5"
                    checked={set.has(p.key)}
                    disabled={disabled}
                    onCheckedChange={(c) => onChange(c ? [...value, p.key] : value.filter((k) => k !== p.key))}
                  />
                  <span>
                    <span className="block text-[13px] font-medium">{actionLabel(p.key)}</span>
                    <span className="block text-xs text-muted-foreground">{p.description ?? p.key}</span>
                  </span>
                  <code className="ml-auto rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{p.key}</code>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** Create (role = null) or edit a role. `readOnly` shows it without editing controls. */
export function RoleSheet({ open, role, readOnly, onOpenChange }: { open: boolean; role: Role | null; readOnly?: boolean; onOpenChange: (o: boolean) => void }) {
  const { create, update } = useRoleMutations();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", permissions: [] as string[] } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset({ name: role?.name ?? "", description: role?.description ?? "", permissions: role?.permissions ?? [] });
  }, [open, role, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const body = { ...v, description: v.description || null };
    try {
      if (role) {
        await update.mutateAsync({ id: role.id, ...body });
        toast.success("Role updated");
      } else {
        await create.mutateAsync(body);
      }
      onOpenChange(false);
    } catch (e) {
      applyFieldErrors(e, form.setError);
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b p-6">
          <SheetTitle>{readOnly ? role?.name : role ? "Edit role" : "New role"}</SheetTitle>
          <SheetDescription>
            {role?.isSystem ? "Built-in role. It can be edited but not deleted." : "Group permissions into a role you can assign to users."}
          </SheetDescription>
        </SheetHeader>
        <form id="role-form" onSubmit={onSubmit} className="flex-1 space-y-5 overflow-y-auto p-6" noValidate>
          <FormField label="Name" error={errors.name?.message}>
            {(p) => <Input {...p} disabled={readOnly} {...form.register("name")} />}
          </FormField>
          <FormField label="Description" error={errors.description?.message}>
            {(p) => <Textarea {...p} rows={2} disabled={readOnly} className="rounded-lg bg-card" {...form.register("description")} />}
          </FormField>
          <div className="space-y-2">
            <p className="text-[13px] font-medium">Permissions</p>
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => <PermissionChecklist value={field.value} onChange={field.onChange} disabled={readOnly} />}
            />
          </div>
        </form>
        {!readOnly && (
          <SheetFooter className="flex-row justify-end border-t p-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="role-form" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {role ? "Save role" : "Create role"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
