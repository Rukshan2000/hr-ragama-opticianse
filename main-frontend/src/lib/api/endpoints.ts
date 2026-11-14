import { api } from "./client";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type {
  Branch,
  Department,
  Employee,
  EmployeeHistory,
  EmployeeStatus,
  OrgLevel,
  OrgUnit,
} from "./types";
import type {
  ListParams,
  LoginResult,
  Me,
  MfaMethod,
  MfaStatus,
  Passkey,
  Permission,
  Role,
  SessionResult,
  Tenant,
  User,
} from "./types";

export const authApi = {
  me: () => api.get<Me>("auth/me"),
  login: (b: { email: string; password: string; tenantSlug?: string }) =>
    api.post<LoginResult>("auth/login", b),
  logout: () => api.post<null>("auth/logout"),
  logoutAll: () => api.post<null>("auth/logout-all"),
  switchTenant: (tenantSlug: string) =>
    api.post<SessionResult>("auth/switch-tenant", { tenantSlug }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    api.post<null>("auth/change-password", b),
  forgotPassword: (email: string) =>
    api.post<null>("auth/forgot-password", { email }),
  resetPassword: (b: { token: string; newPassword: string }) =>
    api.post<null>("auth/reset-password", b),
};

type Challenge<O> = { challengeId: string; options: O };

export const passkeysApi = {
  list: () => api.get<Passkey[]>("auth/passkeys"),
  registerOptions: () =>
    api.post<Challenge<PublicKeyCredentialCreationOptionsJSON>>(
      "auth/passkeys/register/options",
    ),
  registerVerify: (b: {
    challengeId: string;
    response: unknown;
    deviceName?: string;
  }) => api.post<Passkey>("auth/passkeys/register/verify", b),
  loginOptions: (email?: string) =>
    api.post<Challenge<PublicKeyCredentialRequestOptionsJSON>>(
      "auth/passkeys/login/options",
      email ? { email } : {},
    ),
  loginVerify: (b: { challengeId: string; response: unknown }) =>
    api.post<SessionResult>("auth/passkeys/login/verify", b),
  rename: (id: string, deviceName: string) =>
    api.patch<Passkey>(`auth/passkeys/${id}`, { deviceName }),
  remove: (id: string, currentPassword: string) =>
    api.delete<null>(`auth/passkeys/${id}`, { currentPassword }),
};

type Codes = { recoveryCodes?: string[] };
const pw = (currentPassword: string) => ({ currentPassword });

export const mfaApi = {
  status: () => api.get<MfaStatus>("auth/mfa"),
  verify: (b: {
    mfaToken: string;
    method: MfaMethod;
    code?: string;
    response?: unknown;
  }) => api.post<SessionResult>("auth/mfa/verify", b),
  sendEmail: (mfaToken: string) =>
    api.post<null>("auth/mfa/challenge/email", { mfaToken }),
  passkeyOptions: (mfaToken: string) =>
    api.post<PublicKeyCredentialRequestOptionsJSON>(
      "auth/mfa/challenge/passkey",
      { mfaToken },
    ),
  totpSetup: (currentPassword: string) =>
    api.post<{ secret: string; otpauthUrl: string }>(
      "auth/mfa/totp/setup",
      pw(currentPassword),
    ),
  totpEnable: (code: string) =>
    api.post<Codes>("auth/mfa/totp/enable", { code }),
  enable: (factor: "email" | "passkey", currentPassword: string) =>
    api.post<Codes>(`auth/mfa/${factor}/enable`, pw(currentPassword)),
  disable: (factor: "totp" | "email" | "passkey", currentPassword: string) =>
    api.post<null>(`auth/mfa/${factor}/disable`, pw(currentPassword)),
  regenerate: (currentPassword: string) =>
    api.post<Codes>("auth/mfa/recovery-codes", pw(currentPassword)),
};

export const usersApi = {
  list: (p: ListParams) => api.list<User>("users", p),
  get: (id: string) => api.get<User>(`users/${id}`),
  create: (b: {
    name: string;
    email: string;
    password: string;
    roleIds?: string[];
  }) => api.post<User>("users", b),
  update: (id: string, b: { name?: string; roleIds?: string[] }) =>
    api.patch<User>(`users/${id}`, b),
  setStatus: (id: string, isActive: boolean) =>
    api.patch<User>(`users/${id}/status`, { isActive }),
  remove: (id: string) => api.delete<null>(`users/${id}`),
};

export const rolesApi = {
  list: (p: ListParams) => api.list<Role>("roles", p),
  create: (b: {
    name: string;
    description?: string | null;
    permissions: string[];
  }) => api.post<Role>("roles", b),
  update: (
    id: string,
    b: { name?: string; description?: string | null; permissions?: string[] },
  ) => api.patch<Role>(`roles/${id}`, b),
  remove: (id: string) => api.delete<null>(`roles/${id}`),
};

export const permissionsApi = {
  list: () => api.get<Permission[]>("permissions"),
};

export const tenantsApi = {
  list: (p: ListParams) => api.list<Tenant>("tenants", p),
  create: (b: {
    name: string;
    slug?: string;
    owner?: { name: string; email: string; password: string };
  }) => api.post<Tenant>("tenants", b),
  update: (id: string, b: { name?: string; isActive?: boolean }) =>
    api.patch<Tenant>(`tenants/${id}`, b),
  remove: (id: string) => api.delete<null>(`tenants/${id}`),
};

export const healthApi = {
  ready: () => api.get<{ status: string; database: string }>("health/ready"),
};

/* ── HR ───────────────────────────────────────────────────────── */

type Query = Record<string, string | number | boolean | undefined>;

/** Same CRUD surface for every organization master-data resource. */
const masterApi = <T>(path: string) => ({
  list: (p: ListParams & Query) => api.list<T>(`organization/${path}`, p),
  create: (b: object) => api.post<T>(`organization/${path}`, b),
  update: (id: string, b: object) =>
    api.patch<T>(`organization/${path}/${id}`, b),
  remove: (id: string) => api.delete<null>(`organization/${path}/${id}`),
  nextCode: () => api.get<{ code: string }>(`organization/${path}/next-code`),
});

export const organizationApi = {
  branches: masterApi<Branch>("branches"),
  departments: masterApi<Department>("departments"),
  designations: masterApi<Department>("designations"),
  levels: masterApi<OrgLevel>("levels"),
  units: {
    list: () => api.get<OrgUnit[]>("organization/units"),
    create: (b: object) => api.post<OrgUnit>("organization/units", b),
    update: (id: string, b: object) =>
      api.patch<OrgUnit>(`organization/units/${id}`, b),
    remove: (id: string) => api.delete<null>(`organization/units/${id}`),
    generate: async () => (await api.post<{ created: number }>("organization/units/generate")).data,
  },
};

export const employeesApi = {
  list: (p: ListParams & Query) => api.list<Employee>("employees", p),
  get: (id: string) => api.get<Employee>(`employees/${id}`),
  history: (id: string) =>
    api.get<EmployeeHistory[]>(`employees/${id}/history`),
  create: (b: object) => api.post<Employee>("employees", b),
  update: (id: string, b: object) => api.patch<Employee>(`employees/${id}`, b),
  assignment: (id: string, b: object) =>
    api.post<Employee>(`employees/${id}/assignment`, b),
  status: (
    id: string,
    b: { status: EmployeeStatus; effectiveDate: string; reason?: string },
  ) => api.post<Employee>(`employees/${id}/status`, b),
  remove: (id: string) => api.delete<null>(`employees/${id}`),
};
