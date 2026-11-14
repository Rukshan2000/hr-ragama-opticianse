import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';

export const idParams = z.object({ id: z.uuid() });

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore')
  .transform((c) => c.toUpperCase());
const name = z.string().trim().min(1).max(150);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const timezones = new Set(Intl.supportedValuesOf('timeZone'));
const timezone = z.string().refine((tz) => timezones.has(tz), 'Unknown IANA time zone');

const isActiveFilter = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const masterListQuery = listQuerySchema(['name', 'code', 'createdAt'], 'name').extend({
  isActive: isActiveFilter,
});

export const branchBody = z.object({
  // Omit to auto-generate (BR-001, BR-002, …).
  code: code.optional(),
  name,
  address: optionalText(500),
  phone: optionalText(30),
  email: z.email().max(255).nullish(),
  timezone: timezone.default('Asia/Colombo'),
  isActive: z.boolean().default(true),
});

export const departmentBody = z.object({
  code: code.optional(),
  name,
  description: optionalText(500),
  isActive: z.boolean().default(true),
});

/** Designations share the department shape (code, job title, description). */
export const designationBody = departmentBody;

export const levelListQuery = listQuerySchema(['rank', 'name', 'createdAt'], 'rank');
export const levelBody = z.object({
  name: z.string().trim().min(1).max(100),
  rank: z.number().int().min(1).max(50),
  description: optionalText(500),
});

export const unitBody = z.object({
  name,
  code: code.nullish(),
  parentId: z.uuid().nullable().default(null),
  levelId: z.uuid(),
  departmentId: z.uuid().nullish(),
  description: optionalText(500),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

const atLeastOne = <T extends z.ZodObject>(s: T) =>
  s.partial().refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

// PATCH bodies: no defaults, so omitted fields stay untouched.
export const branchPatch = atLeastOne(
  branchBody.extend({ timezone: timezone, isActive: z.boolean() }),
);
export const departmentPatch = atLeastOne(departmentBody.extend({ isActive: z.boolean() }));
export const designationPatch = departmentPatch;
export const levelPatch = atLeastOne(levelBody);
export const unitPatch = atLeastOne(
  unitBody.extend({
    parentId: z.uuid().nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  }),
);

export type IdParams = z.infer<typeof idParams>;
export type MasterListQuery = z.infer<typeof masterListQuery>;
export type LevelListQuery = z.infer<typeof levelListQuery>;
export type UnitBody = z.infer<typeof unitBody>;
export type UnitPatch = z.infer<typeof unitPatch>;
