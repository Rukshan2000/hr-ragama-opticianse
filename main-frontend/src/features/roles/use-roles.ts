"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { permissionsApi, rolesApi } from "@/lib/api/endpoints";
import type { ListParams, Permission } from "@/lib/api/types";
import { isAssignable } from "./permission-groups";

export const useRoles = (params: ListParams) =>
  useQuery({ queryKey: ["roles", "list", params], queryFn: () => rolesApi.list(params), placeholderData: (p) => p });

/** Assignable permission catalog. Falls back to keys seen on roles if the user can't read the catalog. */
export function useAssignablePermissions(fallbackKeys: string[] = []) {
  const { can } = useSession();
  const q = useQuery({ queryKey: ["permissions"], queryFn: permissionsApi.list, enabled: can("permissions:read"), staleTime: 5 * 60_000 });
  const perms: Permission[] = q.data ?? [...new Set(fallbackKeys)].sort().map((key) => ({ id: key, key, description: null }));
  return { ...q, permissions: perms.filter((p) => isAssignable(p.key)) };
}

export function useRoleMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["roles"] });
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["auth", "me"] }); // own permissions may have changed
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));
  return {
    create: useMutation({ mutationFn: rolesApi.create, onSuccess: (r) => (toast.success(`Role “${r.data.name}” created`), invalidate()), onError }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string | null; permissions?: string[] }) => rolesApi.update(id, b),
      onSuccess: invalidate,
      onError,
    }),
    remove: useMutation({ mutationFn: rolesApi.remove, onSuccess: () => (toast.success("Role deleted"), invalidate()), onError }),
  };
}
