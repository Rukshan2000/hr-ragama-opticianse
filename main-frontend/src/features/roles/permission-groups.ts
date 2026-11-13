import type { Permission } from "@/lib/api/types";

export interface PermissionGroup {
  resource: string;
  label: string;
  permissions: Permission[];
}

/** Groups "users:read"-style keys by resource. Platform-only (tenants:*) keys are excluded by callers as needed. */
export function groupPermissions(perms: Permission[]): PermissionGroup[] {
  const map = new Map<string, Permission[]>();
  for (const p of perms) {
    const resource = p.key.split(":")[0]!;
    map.set(resource, [...(map.get(resource) ?? []), p]);
  }
  return [...map].map(([resource, permissions]) => ({
    resource,
    label: resource[0]!.toUpperCase() + resource.slice(1),
    permissions,
  }));
}

/** Tenant roles can only hold tenant-scoped permissions (backend rejects tenants:*). */
export const isAssignable = (key: string) => !key.startsWith("tenants:");

export const actionLabel = (key: string) => {
  const a = key.split(":")[1] ?? key;
  return a[0]!.toUpperCase() + a.slice(1);
};
