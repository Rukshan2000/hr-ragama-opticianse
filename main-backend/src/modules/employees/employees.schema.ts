import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';

export const EMPLOYEE_STATUSES = [
  'onboarding',
  'probation',
  'active',
  'on_notice',
  'inactive',
  'resigned',
  'terminated',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYMENT_TYPES = ['permanent', 'temporary', 'contract', 'internship'] as const;
export const GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;

/** Allowed status moves. resigned/terminated are final; rehiring creates a new record. */
export const STATUS_TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  onboarding: ['probation', 'active', 'inactive'],
  probation: ['active', 'on_notice', 'inactive', 'terminated'],
  active: ['on_notice', 'inactive', 'resigned', 'terminated'],
  on_notice: ['active', 'resigned', 'terminated'],
  inactive: ['active'],
  resigned: [],
  terminated: [],
};

export const idParams = z.object({ id: z.uuid() });

export const isoDate = z.iso.date();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const listEmployeesQuery = listQuerySchema(
  ['name', 'employeeNumber', 'joiningDate', 'createdAt'],
  'name',
).extend({
  order: z.enum(['asc', 'desc']).default('asc'),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: z.uuid().optional(),
  designationId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  managerId: z.uuid().optional(),
});

/** Personal/profile fields: editable with employees:update, no history needed. */
const profile = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  displayName: text(150),
  email: z
    .email()
    .max(255)
    .transform((e) => e.toLowerCase())
    .nullish(),
  phone: text(30),
  dateOfBirth: isoDate.nullish(),
  gender: z.enum(GENDERS).nullish(),
  address: text(500),
  emergencyContactName: text(150),
  emergencyContactPhone: text(30),
  emergencyContactRelationship: text(50),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  probationStartDate: isoDate.nullish(),
  probationEndDate: isoDate.nullish(),
  notes: text(5000),
};

const datesInOrder = (b: {
  probationStartDate?: string | null;
  probationEndDate?: string | null;
}) => !b.probationStartDate || !b.probationEndDate || b.probationEndDate >= b.probationStartDate;
const datesMsg = {
  message: 'Probation end must be on or after its start',
  path: ['probationEndDate'],
};

export const createEmployeeBody = z
  .object({
    ...profile,
    employeeNumber: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, dot, dash, slash or underscore'),
    employmentType: profile.employmentType.default('permanent'),
    joiningDate: isoDate,
    status: z.enum(['onboarding', 'probation', 'active']).default('onboarding'),
    departmentId: z.uuid().nullish(),
    designationId: z.uuid().nullish(),
    branchId: z.uuid().nullish(),
    managerId: z.uuid().nullish(),
  })
  .refine(datesInOrder, datesMsg)
  .refine((b) => !b.dateOfBirth || b.dateOfBirth < b.joiningDate, {
    message: 'Date of birth must be before the joining date',
    path: ['dateOfBirth'],
  });

export const updateEmployeeBody = z
  .object(profile)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
  .refine(datesInOrder, datesMsg);

/** Transfer / promotion / manager change. Each changed field is written to history. */
export const assignmentBody = z
  .object({
    departmentId: z.uuid().nullable().optional(),
    designationId: z.uuid().nullable().optional(),
    branchId: z.uuid().nullable().optional(),
    managerId: z.uuid().nullable().optional(),
    effectiveDate: isoDate,
    reason: text(500),
  })
  .refine(
    (b) => ['departmentId', 'designationId', 'branchId', 'managerId'].some((k) => k in b),
    'Change at least one of department, designation, branch or manager',
  );

export const statusBody = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  effectiveDate: isoDate,
  reason: text(500),
});

export type IdParams = z.infer<typeof idParams>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuery>;
export type CreateEmployeeBody = z.infer<typeof createEmployeeBody>;
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeBody>;
export type AssignmentBody = z.infer<typeof assignmentBody>;
export type StatusBody = z.infer<typeof statusBody>;
