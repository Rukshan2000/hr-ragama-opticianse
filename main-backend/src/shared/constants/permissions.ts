/**
 * Single source of truth for permission keys. The seed syncs this catalog into the
 * `permissions` table; routes reference these constants, never raw strings.
 */
export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',
  PERMISSIONS_READ: 'permissions:read',
  TENANTS_READ: 'tenants:read',
  TENANTS_MANAGE: 'tenants:manage',
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_MANAGE: 'organization:manage',
  EMPLOYEES_READ: 'employees:read',
  EMPLOYEES_CREATE: 'employees:create',
  EMPLOYEES_UPDATE: 'employees:update',
  EMPLOYEES_DELETE: 'employees:delete',
  EMPLOYEES_MANAGE: 'employees:manage',
  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_MANAGE: 'documents:manage',
  CONTRACTS_READ: 'contracts:read',
  CONTRACTS_MANAGE: 'contracts:manage',
  ATTENDANCE_READ: 'attendance:read',
  ATTENDANCE_MANAGE: 'attendance:manage',
  ATTENDANCE_APPROVE: 'attendance:approve',
  SHIFTS_MANAGE: 'shifts:manage',
  HOLIDAYS_MANAGE: 'holidays:manage',
  LEAVE_READ: 'leave:read',
  LEAVE_CREATE: 'leave:create',
  LEAVE_APPROVE: 'leave:approve',
  LEAVE_MANAGE: 'leave:manage',
  PAYROLL_READ: 'payroll:read',
  PAYROLL_MANAGE: 'payroll:manage',
  PAYROLL_APPROVE: 'payroll:approve',
  RECRUITMENT_READ: 'recruitment:read',
  RECRUITMENT_MANAGE: 'recruitment:manage',
  PERFORMANCE_READ: 'performance:read',
  PERFORMANCE_MANAGE: 'performance:manage',
  TRAINING_READ: 'training:read',
  TRAINING_MANAGE: 'training:manage',
  ASSETS_READ: 'assets:read',
  ASSETS_MANAGE: 'assets:manage',
  EXPENSES_READ: 'expenses:read',
  EXPENSES_APPROVE: 'expenses:approve',
  EXPENSES_MANAGE: 'expenses:manage',
  EXIT_READ: 'exit:read',
  EXIT_MANAGE: 'exit:manage',
  WORKFLOWS_MANAGE: 'workflows:manage',
  ANNOUNCEMENTS_MANAGE: 'announcements:manage',
  AUDIT_READ: 'audit:read',
  REPORTS_READ: 'reports:read',
  SETTINGS_MANAGE: 'settings:manage',
  SELF_SERVICE: 'self:access',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'users:read': 'View users in the tenant',
  'users:create': 'Add users to the tenant',
  'users:update': 'Edit users, their roles and status',
  'users:delete': 'Remove users from the tenant',
  'roles:read': 'View roles',
  'roles:manage': 'Create, edit and delete roles',
  'permissions:read': 'View the permission catalog',
  'tenants:read': 'View all tenants (platform)',
  'tenants:manage': 'Create and edit tenants (platform)',
  'organization:read': 'View branches, departments, designations and the organization chart',
  'organization:manage': 'Create, edit and delete organization structure',
  'employees:read': 'View employee records, including personal details',
  'employees:create': 'Add employees',
  'employees:update': 'Edit employee profile details',
  'employees:delete': 'Archive employee records',
  'employees:manage': 'Transfer, promote, change managers and change employment status',
  'documents:read': 'View employee documents',
  'documents:manage': 'Upload and delete employee documents and photos',
  'contracts:read': 'View employment contracts',
  'contracts:manage': 'Create, renew, confirm and end employment contracts',
  'attendance:read': 'View attendance of all employees',
  'attendance:manage': 'Record and edit attendance, configure attendance policy',
  'attendance:approve': 'Approve attendance correction requests',
  'shifts:manage': 'Manage shifts, work schedules and schedule assignments',
  'holidays:manage': 'Manage holiday calendars',
  'leave:read': 'View leave requests and balances of all employees',
  'leave:create': 'Apply for leave on behalf of employees',
  'leave:approve': 'Approve or reject leave requests',
  'leave:manage': 'Manage leave types, policies and balances',
  'payroll:read': 'View salaries, payroll runs and payslips (confidential)',
  'payroll:manage': 'Manage salaries, payroll policies and run payroll calculations',
  'payroll:approve': 'Approve (finalize) and lock payroll runs',
  'recruitment:read': 'View vacancies and applicants',
  'recruitment:manage': 'Manage vacancies, applicants, interviews and offers',
  'performance:read': 'View performance cycles and reviews',
  'performance:manage': 'Manage performance cycles and reviews',
  'training:read': 'View training programs and enrollments',
  'training:manage': 'Manage training programs and enrollments',
  'assets:read': 'View assets and assignments',
  'assets:manage': 'Register, assign and return assets',
  'expenses:read': 'View expense claims of all employees',
  'expenses:approve': 'Approve or reject expense claims',
  'expenses:manage': 'Manage expense categories and record reimbursements',
  'exit:read': 'View exit cases',
  'exit:manage': 'Manage resignations, terminations, clearance and settlements',
  'workflows:manage': 'Configure approval workflows and delegations',
  'announcements:manage': 'Publish company announcements',
  'audit:read': 'View the audit log',
  'reports:read': 'View HR reports and exports',
  'settings:manage': 'Manage organization HR settings',
  'self:access': 'Use the employee self-service portal',
};

const ALL = Object.values(PERMISSIONS);
const TENANT_SCOPED = ALL.filter((p) => !p.startsWith('tenants:'));

/** Permissions that may be granted to tenant roles. */
export const TENANT_PERMISSIONS = TENANT_SCOPED as [Permission, ...Permission[]];

/** Platform role: tenant_id IS NULL. */
export const PLATFORM_ROLES = [
  { slug: 'super-admin', name: 'Super Admin', permissions: ALL },
] as const;

const P = PERMISSIONS;
const SELF: Permission[] = [P.ORGANIZATION_READ, P.SELF_SERVICE];
const HR_STAFF: Permission[] = [
  ...SELF,
  P.EMPLOYEES_READ,
  P.EMPLOYEES_CREATE,
  P.EMPLOYEES_UPDATE,
  P.EMPLOYEES_MANAGE,
  P.DOCUMENTS_READ,
  P.DOCUMENTS_MANAGE,
  P.CONTRACTS_READ,
  P.CONTRACTS_MANAGE,
  P.ATTENDANCE_READ,
  P.ATTENDANCE_MANAGE,
  P.ATTENDANCE_APPROVE,
  P.SHIFTS_MANAGE,
  P.HOLIDAYS_MANAGE,
  P.LEAVE_READ,
  P.LEAVE_CREATE,
  P.LEAVE_APPROVE,
  P.LEAVE_MANAGE,
  P.PERFORMANCE_READ,
  P.PERFORMANCE_MANAGE,
  P.TRAINING_READ,
  P.TRAINING_MANAGE,
  P.ASSETS_READ,
  P.ASSETS_MANAGE,
  P.EXPENSES_READ,
  P.EXPENSES_APPROVE,
  P.EXIT_READ,
  P.EXIT_MANAGE,
  P.ANNOUNCEMENTS_MANAGE,
  P.REPORTS_READ,
];
/** Managers act on their own team: approvals are scoped to direct reports by the workflow engine. */
const TEAM_LEAD: Permission[] = [...SELF, P.EMPLOYEES_READ, P.PERFORMANCE_READ];

/**
 * Created for every new tenant (and back-filled by the seed for existing ones);
 * editable afterwards, but `is_system` ones cannot be deleted.
 * Least privilege: payroll is visible only to Payroll Officer, HR Administrator and Admin.
 */
export const DEFAULT_TENANT_ROLES: readonly {
  slug: string;
  name: string;
  permissions: readonly Permission[];
}[] = [
  { slug: 'admin', name: 'Admin', permissions: TENANT_SCOPED },
  {
    slug: 'manager',
    name: 'Manager',
    permissions: [P.USERS_READ, P.USERS_CREATE, P.USERS_UPDATE, P.ROLES_READ, P.PERMISSIONS_READ],
  },
  { slug: 'user', name: 'User', permissions: [P.USERS_READ] },
  {
    slug: 'hr-admin',
    name: 'HR Administrator',
    permissions: [
      ...HR_STAFF,
      P.ORGANIZATION_MANAGE,
      P.EMPLOYEES_DELETE,
      P.USERS_READ,
      P.PAYROLL_READ,
      P.RECRUITMENT_READ,
      P.RECRUITMENT_MANAGE,
      P.EXPENSES_MANAGE,
      P.WORKFLOWS_MANAGE,
      P.AUDIT_READ,
      P.SETTINGS_MANAGE,
    ],
  },
  { slug: 'hr-manager', name: 'HR Manager', permissions: HR_STAFF },
  {
    slug: 'department-manager',
    name: 'Department Manager',
    permissions: [...TEAM_LEAD, P.ATTENDANCE_READ, P.LEAVE_READ, P.REPORTS_READ],
  },
  { slug: 'team-leader', name: 'Team Leader', permissions: TEAM_LEAD },
  { slug: 'employee', name: 'Employee', permissions: SELF },
  {
    slug: 'payroll-officer',
    name: 'Payroll Officer',
    permissions: [
      ...SELF,
      P.EMPLOYEES_READ,
      P.ATTENDANCE_READ,
      P.LEAVE_READ,
      P.PAYROLL_READ,
      P.PAYROLL_MANAGE,
      P.EXPENSES_READ,
      P.EXPENSES_MANAGE,
      P.REPORTS_READ,
    ],
  },
  {
    slug: 'recruiter',
    name: 'Recruiter',
    permissions: [...SELF, P.RECRUITMENT_READ, P.RECRUITMENT_MANAGE],
  },
];

export const TENANT_OWNER_ROLE = 'admin';
export const TENANT_DEFAULT_ROLE = 'user';
