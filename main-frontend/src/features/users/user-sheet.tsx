"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActiveBadge, UserAvatar } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { usersApi } from "@/lib/api/endpoints";
import type { User } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { RolePicker } from "./role-picker";
import { useAllRoles, useUserMutations } from "./use-users";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-subtle/40 px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium">{children}</dd>
    </div>
  );
}

function EditUser({ user, onRemoved }: { user: User; onRemoved: () => void }) {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const isSelf = user.id === me?.id;
  const canEdit = can("users:update");
  const canAssign = canEdit && can("roles:manage", "roles:read") && !isSelf;
  const roles = useAllRoles(canAssign);
  const { setStatus, remove } = useUserMutations();
  const [name, setName] = useState(user.name);
  const [roleIds, setRoleIds] = useState(user.roles.map((r) => r.id));
  const [confirmRemove, setConfirmRemove] = useState(false);

  const nameChanged = name.trim() !== user.name;
  const rolesChanged = [...roleIds].sort().join() !== user.roles.map((r) => r.id).sort().join();
  const save = useMutation({
    mutationFn: () => usersApi.update(user.id, { ...(nameChanged && { name: name.trim() }), ...(rolesChanged && { roleIds }) }),
    onSuccess: () => {
      toast.success("Changes saved");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
      <dl className="grid grid-cols-2 gap-2">
        <Detail label="Status">
          <ActiveBadge active={user.isActive} />
        </Detail>
        <Detail label="Joined">{formatDate(user.joinedAt)}</Detail>
        <Detail label="Last sign-in">{formatDateTime(user.lastLoginAt)}</Detail>
        <Detail label="Roles">{user.roles.map((r) => r.name).join(", ") || "None"}</Detail>
      </dl>

      {canEdit && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Profile</h3>
          <FormField label="Full name" error={name.trim() ? undefined : "Enter a name"}>
            {(p) => <Input {...p} value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />}
          </FormField>
          {canAssign && roles.data && (
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium">Roles</p>
              <RolePicker roles={roles.data.items} value={roleIds} onChange={setRoleIds} />
            </div>
          )}
          {isSelf && <p className="text-xs text-text-muted">You can&apos;t change your own roles or status.</p>}
          <Button onClick={() => save.mutate()} disabled={!(nameChanged || rolesChanged) || !name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
        </section>
      )}

      {canEdit && !isSelf && (
        <section className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div>
            <p className="text-[13px] font-medium">Account access</p>
            <p className="text-xs text-muted-foreground">{user.isActive ? "User can sign in to this organization." : "User is blocked from this organization."}</p>
          </div>
          <Switch
            checked={user.isActive}
            disabled={setStatus.isPending}
            aria-label={user.isActive ? "Deactivate user" : "Activate user"}
            onCheckedChange={(isActive) => setStatus.mutate({ id: user.id, isActive })}
          />
        </section>
      )}

      {can("users:delete") && !isSelf && (
        <section className="flex items-center justify-between gap-4 rounded-xl border border-danger/20 bg-danger/5 p-4">
          <div>
            <p className="text-[13px] font-medium">Remove from organization</p>
            <p className="text-xs text-muted-foreground">Revokes membership and roles here. The account itself remains.</p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setConfirmRemove(true)}>
            <Trash2 /> Remove
          </Button>
        </section>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${user.name}?`}
        description="They will lose access to this organization immediately."
        confirmLabel="Remove user"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(user.id, {
            onSuccess: () => {
              setConfirmRemove(false);
              onRemoved();
            },
          })
        }
      />
    </div>
  );
}

export function UserSheet({ userId, onOpenChange }: { userId: string | null; onOpenChange: (open: boolean) => void }) {
  const user = useQuery({ queryKey: ["users", "detail", userId], queryFn: () => usersApi.get(userId!), enabled: Boolean(userId) });
  return (
    <Sheet open={Boolean(userId)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="p-6">
          {user.data ? (
            <div className="flex items-center gap-3">
              <UserAvatar name={user.data.name} size="lg" />
              <div className="min-w-0">
                <SheetTitle className="truncate text-base">{user.data.name}</SheetTitle>
                <SheetDescription className="truncate">{user.data.email}</SheetDescription>
              </div>
            </div>
          ) : (
            <SheetTitle>User details</SheetTitle>
          )}
        </SheetHeader>
        {user.isPending ? (
          <LoadingState className="px-6" rows={4} />
        ) : user.error ? (
          <ErrorState message={user.error.message} onRetry={() => user.refetch()} />
        ) : (
          <EditUser key={`${user.data.id}:${user.data.name}:${user.data.roles.map((r) => r.id).join()}`} user={user.data} onRemoved={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
