"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField, PasswordInput } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/features/auth/auth-card";
import { useSession } from "@/hooks/use-session";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { usersApi } from "@/lib/api/endpoints";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { RolePicker } from "./role-picker";
import { useAllRoles } from "./use-users";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(150),
  email: emailSchema,
  password: passwordSchema,
  roleIds: z.array(z.string()),
});

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const canAssign = can("roles:manage", "roles:read");
  const roles = useAllRoles(open && canAssign);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "", roleIds: [] as string[] } });
  const { errors, isSubmitting } = form.formState;

  const close = (o: boolean) => {
    if (!o) {
      form.reset();
      setError(null);
    }
    onOpenChange(o);
  };

  const onSubmit = form.handleSubmit(async ({ roleIds, ...v }) => {
    setError(null);
    try {
      // Omit roleIds unless the caller may assign them; the backend then applies the default role.
      await usersApi.create(canAssign && roleIds.length ? { ...v, roleIds } : v);
      toast.success(`${v.name} was added`);
      qc.invalidateQueries({ queryKey: ["users"] });
      close(false);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Create an account and add it to this organization. Share the initial password securely.</DialogDescription>
        </DialogHeader>
        <form id="create-user" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" error={errors.name?.message}>
              {(p) => <Input {...p} {...form.register("name")} />}
            </FormField>
            <FormField label="Email" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...form.register("email")} />}
            </FormField>
          </div>
          <FormField label="Initial password" error={errors.password?.message} hint="10+ characters with upper, lower case and a number">
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register("password")} />}
          </FormField>
          {canAssign && roles.data && (
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium">Roles</p>
              <Controller control={form.control} name="roleIds" render={({ field }) => <RolePicker roles={roles.data.items} value={field.value} onChange={field.onChange} />} />
              <p className="text-xs text-text-muted">Leave empty to give the default User role.</p>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-user" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            Add user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
