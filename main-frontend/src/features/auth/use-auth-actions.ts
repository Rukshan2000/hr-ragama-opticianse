"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { HUB_URL } from "@/components/layout/app-switcher";
import { authApi } from "@/lib/api/endpoints";

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      qc.clear();
      // Single logout: the hub signs the user out of every other app too.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- external hub URL
      if (HUB_URL) window.location.assign(`${HUB_URL}/logout`);
      else router.replace("/login");
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
