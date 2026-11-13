"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ActiveBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField, PasswordInput } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { FormAlert } from "@/features/auth/auth-card";
import { useSession } from "@/hooks/use-session";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { tenantsApi } from "@/lib/api/endpoints";
import type { Tenant } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { emailSchema, passwordSchema } from "@/lib/validation";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(150),
    slug: z.string().trim().max(100).refine((s) => !s || (s.length >= 2 && SLUG.test(s)), "Lowercase letters, numbers and hyphens"),
    withOwner: z.boolean(),
    ownerName: z.string().trim().max(150),
    ownerEmail: z.string().trim(),
    ownerPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.withOwner) return;
    if (!v.ownerName) ctx.addIssue({ code: "custom", path: ["ownerName"], message: "Enter a name" });
    const email = emailSchema.safeParse(v.ownerEmail);
    if (!email.success) ctx.addIssue({ code: "custom", path: ["ownerEmail"], message: "Enter a valid email" });
    const pw = passwordSchema.safeParse(v.ownerPassword);
    if (!pw.success) ctx.addIssue({ code: "custom", path: ["ownerPassword"], message: pw.error.issues[0]!.message });
  });

export function useTenantInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["tenants"] });
}

export function CreateTenantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useTenantInvalidate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", slug: "", withOwner: true, ownerName: "", ownerEmail: "", ownerPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const withOwner = useWatch({ control: form.control, name: "withOwner" });

  const close = (o: boolean) => {
    if (!o) {
      form.reset();
      setError(null);
    }
    onOpenChange(o);
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const { data } = await tenantsApi.create({
        name: v.name,
        slug: v.slug || undefined,
        owner: v.withOwner ? { name: v.ownerName, email: v.ownerEmail.toLowerCase(), password: v.ownerPassword } : undefined,
      });
      toast.success(`Tenant “${data.name}” created`);
      invalidate();
      close(false);
    } catch (e) {
      if (!applyFieldErrors(e, (f: never, err) => form.setError(String(f).replace(/^owner\.(\w)/, (_, c: string) => `owner${c.toUpperCase()}`) as never, err))) {
        setError(errorMessage(e));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create tenant</DialogTitle>
          <DialogDescription>Provisions an organization with the default Admin, Manager and User roles.</DialogDescription>
        </DialogHeader>
        <form id="create-tenant" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" error={errors.name?.message}>
              {(p) => <Input {...p} {...form.register("name")} />}
            </FormField>
            <FormField label="Slug" error={errors.slug?.message} hint="Optional — generated from the name">
              {(p) => <Input {...p} placeholder="acme-inc" {...form.register("slug")} />}
            </FormField>
          </div>
          <div className="rounded-xl border">
            <label className="flex cursor-pointer items-center justify-between gap-3 p-3">
              <span>
                <span className="block text-[13px] font-medium">Create an owner account</span>
                <span className="block text-xs text-muted-foreground">The owner becomes the tenant&apos;s Admin.</span>
              </span>
              <Switch checked={withOwner} onCheckedChange={(c) => form.setValue("withOwner", c)} />
            </label>
            {withOwner && (
              <div className="space-y-4 border-t border-border-subtle p-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Owner name" error={errors.ownerName?.message}>
                    {(p) => <Input {...p} {...form.register("ownerName")} />}
                  </FormField>
                  <FormField label="Owner email" error={errors.ownerEmail?.message}>
                    {(p) => <Input {...p} type="email" {...form.register("ownerEmail")} />}
                  </FormField>
                </div>
                <FormField label="Initial password" error={errors.ownerPassword?.message}>
                  {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register("ownerPassword")} />}
                </FormField>
              </div>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-tenant" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            Create tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TenantSheet({ tenant, onOpenChange }: { tenant: Tenant | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useSession();
  const canManage = can("tenants:manage");
  const invalidate = useTenantInvalidate();
  const [updated, setUpdated] = useState<Tenant | null>(null);
  const [draftName, setDraftName] = useState<{ id: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = updated && updated.id === tenant?.id ? updated : tenant;
  const name = draftName && draftName.id === current?.id ? draftName.value : (current?.name ?? "");
  const setName = (value: string) => current && setDraftName({ id: current.id, value });

  const update = useMutation({
    mutationFn: (b: { name?: string; isActive?: boolean }) => tenantsApi.update(current!.id, b),
    onSuccess: (r) => {
      setUpdated(r.data);
      toast.success("Tenant updated");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => tenantsApi.remove(current!.id),
    onSuccess: () => {
      toast.success("Tenant deleted");
      invalidate();
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const t = current;
  const nameValid = name.trim().length >= 2;
  return (
    <Sheet open={Boolean(tenant)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="p-6">
          <SheetTitle>{t?.name}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{t?.slug}</SheetDescription>
        </SheetHeader>
        {t && (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ["Status", <ActiveBadge key="s" active={t.isActive} />],
                ["Created", formatDate(t.createdAt)],
                ["Updated", formatDate(t.updatedAt)],
                ["Tenant ID", <span key="id" className="font-mono text-[11px]">{t.id.slice(0, 8)}…</span>],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border bg-subtle/40 px-3 py-2.5">
                  <dt className="text-[11px] font-medium tracking-wide text-text-muted uppercase">{label}</dt>
                  <dd className="mt-0.5 truncate text-[13px] font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {canManage && (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Details</h3>
                  <FormField label="Name" error={nameValid ? undefined : "At least 2 characters"}>
                    {(p) => <Input {...p} value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />}
                  </FormField>
                  <Button disabled={!nameValid || name.trim() === t.name || update.isPending} onClick={() => update.mutate({ name: name.trim() })}>
                    {update.isPending && <Loader2 className="animate-spin" />}
                    Save
                  </Button>
                </section>
                <section className="flex items-center justify-between gap-4 rounded-xl border p-4">
                  <div>
                    <p className="text-[13px] font-medium">Tenant active</p>
                    <p className="text-xs text-muted-foreground">Inactive tenants can&apos;t be signed in to.</p>
                  </div>
                  <Switch checked={t.isActive} disabled={update.isPending} aria-label="Tenant active" onCheckedChange={(isActive) => update.mutate({ isActive })} />
                </section>
                <section className="flex items-center justify-between gap-4 rounded-xl border border-danger/20 bg-danger/5 p-4">
                  <div>
                    <p className="text-[13px] font-medium">Delete tenant</p>
                    <p className="text-xs text-muted-foreground">Soft-deletes the tenant and blocks all access.</p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete
                  </Button>
                </section>
              </>
            )}
          </div>
        )}
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${t?.name}?`}
          description="Members will immediately lose access to this tenant."
          confirmLabel="Delete tenant"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </SheetContent>
    </Sheet>
  );
}
