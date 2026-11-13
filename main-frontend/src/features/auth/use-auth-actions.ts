"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      router.replace("/login");
      qc.clear();
    },
  });
}

export function useSwitchTenant() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: authApi.switchTenant,
    onSuccess: (r) => {
      qc.clear(); // every cached list belongs to the previous tenant
      toast.success(`Switched to ${r.data.tenant?.name ?? "platform"}`);
      router.replace("/");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
