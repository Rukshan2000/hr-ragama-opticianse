"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { rolesApi, usersApi } from "@/lib/api/endpoints";
import type { ListParams } from "@/lib/api/types";

export const useUsers = (params: ListParams) =>
  useQuery({ queryKey: ["users", "list", params], queryFn: () => usersApi.list(params), placeholderData: (p) => p });

/** Every tenant role, for assignment pickers (backend caps limit at 100). */
export const useAllRoles = (enabled: boolean) =>
  useQuery({ queryKey: ["roles", "all"], queryFn: () => rolesApi.list({ limit: 100, sort: "name", order: "asc" }), enabled });

export function useUserMutations() {
  const qc = useQueryClient();
  const done = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));
  return {
    setStatus: useMutation({
      mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => usersApi.setStatus(id, isActive),
      onSuccess: (r) => done(r.data.isActive ? "User activated" : "User deactivated")(),
      onError,
    }),
    remove: useMutation({ mutationFn: usersApi.remove, onSuccess: done("User removed from organization"), onError }),
  };
}
