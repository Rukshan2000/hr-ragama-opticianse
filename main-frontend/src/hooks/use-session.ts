"use client";

import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/lib/api/endpoints";

export const sessionKey = ["auth", "me"] as const;

export function useSession() {
  const query = useQuery({ queryKey: sessionKey, queryFn: authApi.me, staleTime: 60_000 });
  const permissions = new Set(query.data?.permissions ?? []);
  return {
    ...query,
    me: query.data,
    /** Users/roles live in a tenant; tenants:* only exist in platform context (tenant = null). */
    inTenant: Boolean(query.data?.tenant),
    can: (...keys: string[]) => keys.every((k) => permissions.has(k)),
  };
}
