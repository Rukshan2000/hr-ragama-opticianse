/** Shapes mirror the backend DTOs (see main-backend src/modules/*). Dates arrive as ISO strings. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  meta: PaginationMeta | null;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface ListParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
  search?: string;
  isActive?: boolean;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
}

export interface RoleSummary {
  id: string;
  name: string;
  slug: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  lastLoginAt: string | null;
  createdAt: string;
  tenant: TenantSummary | null;
  tenants: TenantSummary[];
  roles: RoleSummary[];
  permissions: string[];
  hubManaged: boolean;
}

/** Login/register/switch-tenant response after the BFF strips the tokens. */
export interface SessionResult {
  user: { id: string; name: string; email: string };
  tenant: TenantSummary | null;
  tenants: TenantSummary[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  joinedAt: string;
  roles: RoleSummary[];
}

export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  key: string;
  description: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Passkey {
  id: string;
  deviceName: string | null;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export type MfaMethod = "totp" | "email" | "passkey" | "recovery";

/** Password login for an account with 2-step verification: no session yet, only a ticket. */
export interface MfaTicket {
  mfaRequired: true;
  mfaToken: string;
  methods: MfaMethod[];
}

export type LoginResult = SessionResult | MfaTicket;

export interface MfaStatus {
  enabled: boolean;
  totp: boolean;
  email: boolean;
  passkey: boolean;
  passkeyCount: number;
  recoveryCodesRemaining: number;
}

/* ── HR: organization ─────────────────────────────────────────── */

export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
}

/** Departments and designations share this shape (name = job title for designations). */
export interface Department {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface OrgLevel {
  id: string;
  name: string;
  rank: number;
  description: string | null;
  createdAt: string;
}

export interface OrgUnit {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  level: { id: string; name: string; rank: number };
  department: { id: string; name: string } | null;
  description: string | null;
  sortOrder: number;
}

/* ── HR: employees ────────────────────────────────────────────── */

export type EmployeeStatus = "onboarding" | "probation" | "active" | "on_notice" | "inactive" | "resigned" | "terminated";
export type EmploymentType = "permanent" | "temporary" | "contract" | "internship";
export type Gender = "male" | "female" | "other" | "undisclosed";

export interface Ref {
  id: string;
  name: string | null;
}

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  address: string | null;
  emergencyContact: { name: string | null; phone: string | null; relationship: string | null };
  status: EmployeeStatus;
  employmentType: EmploymentType;
  joiningDate: string;
  department: Ref | null;
  designation: Ref | null;
  branch: Ref | null;
  manager: (Ref & { employeeNumber: string | null }) | null;
  probationStartDate: string | null;
  probationEndDate: string | null;
  confirmationDate: string | null;
  resignationDate: string | null;
  terminationDate: string | null;
  notes: string | null;
  hasAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeHistory {
  id: string;
  field: "joined" | "department" | "designation" | "branch" | "manager" | "status" | "employment_type";
  oldValue: string | null;
  newValue: string | null;
  oldLabel: string | null;
  newLabel: string | null;
  effectiveDate: string;
  reason: string | null;
  changedBy: Ref | null;
  createdAt: string;
}
