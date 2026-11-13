import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError } from '../../shared/errors/app-error';
import { sendSuccess } from '../../shared/utils/response';
import { tenantScope } from '../../shared/utils/tenant-scope';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import {
  code,
  crudResource,
  employeeJoin,
  idParams,
  isoDate,
  money,
  name,
  patchOf,
  text,
} from '../hr-common/crud';
import { notify } from '../notifications/notifications.service';
import { performanceService, recruitmentService, trainingService } from './talent.service';

const tags = ['Talent'];
const security = [{ bearerAuth: [] }];
const EMPLOYMENT_TYPES = ['permanent', 'temporary', 'contract', 'internship'] as const;
const rating = z.number().min(1).max(5).multipleOf(0.5);

/* ── Recruitment ── */
const vacancyBody = z.object({
  code,
  title: name(150),
  description: z.string().trim().max(20000).nullish(),
  departmentId: z.uuid().nullish(),
  designationId: z.uuid().nullish(),
  branchId: z.uuid().nullish(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('permanent'),
  openings: z.number().int().min(1).max(500).default(1),
  closingDate: isoDate.nullish(),
  status: z.enum(['draft', 'open', 'closed', 'filled']).default('draft'),
});
const vacancies = crudResource({
  table: 'vacancies',
  label: 'Vacancy',
  tag: 'Talent',
  read: P.RECRUITMENT_READ,
  manage: P.RECRUITMENT_MANAGE,
  create: vacancyBody,
  patch: patchOf(vacancyBody),
  filters: {
    status: { column: 'x.status', schema: z.enum(['draft', 'open', 'closed', 'filled']) },
    departmentId: { column: 'x.department_id', schema: z.uuid() },
  },
  search: ['x.title', 'x.code'],
  sort: { title: 'x.title', createdAt: 'x.created_at', closingDate: 'x.closing_date' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
  select: (q) =>
    q
      .leftJoin('departments as d', 'd.id', 'x.department_id')
      .leftJoin('designations as g', 'g.id', 'x.designation_id')
      .leftJoin('branches as b', 'b.id', 'x.branch_id')
      .select(
        'd.name as department_name',
        'g.name as designation_name',
        'b.name as branch_name',
        db.raw(
          `(SELECT count(*)::int FROM job_applications a WHERE a.vacancy_id = x.id) as application_count`,
        ),
      ),
});

const applicantBody = z.object({
  firstName: name(100),
  lastName: name(100),
  email: z
    .email()
    .max(255)
    .transform((e) => e.toLowerCase()),
  phone: text(30),
  cvFileId: z.uuid().nullish(),
  notes: text(1000),
});
const applicants = crudResource({
  table: 'applicants',
  label: 'Applicant',
  tag: 'Talent',
  read: P.RECRUITMENT_READ,
  manage: P.RECRUITMENT_MANAGE,
  create: applicantBody,
  patch: patchOf(applicantBody),
  search: ['x.first_name', 'x.last_name', 'x.email'],
  sort: { name: 'x.first_name', createdAt: 'x.created_at' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
  select: (q) =>
    q
      .leftJoin('files as f', 'f.id', 'x.cv_file_id')
      .select(
        'f.original_name as cv_file_name',
        db.raw(
          `(SELECT count(*)::int FROM job_applications a WHERE a.applicant_id = x.id) as application_count`,
        ),
      ),
  beforeWrite: async ({ tenantId, trx }, data) => {
    if (
      data.cv_file_id &&
      !(await tenantScope(trx, 'files', tenantId)
        .where({ id: data.cv_file_id, purpose: 'cv' })
        .first('id'))
    )
      throw new BadRequestError('Upload the CV first');
  },
});

const STAGES = [
  'applied',
  'screening',
  'interview',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
] as const;
const applications = crudResource({
  table: 'job_applications',
  label: 'Application',
  tag: 'Talent',
  read: P.RECRUITMENT_READ,
  manage: P.RECRUITMENT_MANAGE,
  create: z.object({
    vacancyId: z.uuid(),
    applicantId: z.uuid(),
    rating: z.number().int().min(1).max(5).nullish(),
    notes: text(1000),
  }),
  patch: patchOf(
    z.object({ rating: z.number().int().min(1).max(5).nullable(), notes: text(1000) }),
  ),
  filters: {
    vacancyId: { column: 'x.vacancy_id', schema: z.uuid() },
    applicantId: { column: 'x.applicant_id', schema: z.uuid() },
    stage: { column: 'x.stage', schema: z.enum(STAGES) },
  },
  search: ['p.first_name', 'p.last_name', 'p.email', 'v.title'],
  sort: { createdAt: 'x.created_at', applicant: 'p.first_name', rating: 'x.rating' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
  select: (q) =>
    q
      .join('applicants as p', 'p.id', 'x.applicant_id')
      .join('vacancies as v', 'v.id', 'x.vacancy_id')
      .select(
        db.raw(`p.first_name || ' ' || p.last_name as applicant_name`),
        'p.email as applicant_email',
        'p.cv_file_id',
        'v.title as vacancy_title',
        'v.code as vacancy_code',
      ),
  beforeWrite: async ({ tenantId, trx }, data, existing) => {
    if (!existing) {
      const v = await tenantScope(trx, 'vacancies', tenantId)
        .where({ id: data.vacancy_id })
        .first('status');
      if (v && v.status !== 'open')
        throw new ConflictError('Applications can only be added to open vacancies');
    }
  },
});

const interviews = crudResource({
  table: 'interviews',
  label: 'Interview',
  tag: 'Talent',
  read: P.RECRUITMENT_READ,
  manage: P.RECRUITMENT_MANAGE,
  create: z.object({
    applicationId: z.uuid(),
    scheduledAt: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(10).max(480).default(60),
    interviewerId: z.uuid().nullish(),
    mode: z.enum(['onsite', 'video', 'phone']).default('onsite'),
    location: text(300),
  }),
  patch: patchOf(
    z.object({
      scheduledAt: z.iso.datetime({ offset: true }),
      durationMinutes: z.number().int().min(10).max(480),
      interviewerId: z.uuid().nullable(),
      mode: z.enum(['onsite', 'video', 'phone']),
      location: text(300),
      status: z.enum(['scheduled', 'completed', 'cancelled']),
      score: z.number().int().min(1).max(5).nullable(),
      recommendation: z.enum(['hire', 'hold', 'reject']).nullable(),
      feedback: text(2000),
    }),
  ),
  filters: {
    applicationId: { column: 'x.application_id', schema: z.uuid() },
    status: { column: 'x.status', schema: z.enum(['scheduled', 'completed', 'cancelled']) },
  },
  sort: { scheduledAt: 'x.scheduled_at' },
  defaultSort: 'scheduledAt',
  select: (q) =>
    employeeJoin(
      'x.interviewer_id',
      'interviewer',
    )(q)
      .join('job_applications as a', 'a.id', 'x.application_id')
      .join('applicants as p', 'p.id', 'a.applicant_id')
      .join('vacancies as v', 'v.id', 'a.vacancy_id')
      .select(
        db.raw(`p.first_name || ' ' || p.last_name as applicant_name`),
        'v.title as vacancy_title',
      ),
  beforeWrite: async ({ tenantId, trx }, data, existing) => {
    const interviewer = data.interviewer_id as string | undefined;
    if (interviewer && interviewer !== existing?.interviewer_id) {
      const e = await tenantScope(trx, 'employees', tenantId)
        .where({ id: interviewer })
        .first('user_id');
      await notify(
        {
          tenantId,
          userIds: [e?.user_id],
          type: 'approval_pending',
          title: 'You have an interview to conduct',
          link: '/recruitment',
          dedupeKey: `interview:${existing?.id ?? data.application_id}:${data.scheduled_at ?? existing?.scheduled_at}`,
        },
        trx,
      );
    }
  },
});

/* ── Performance ── */
const cycleBody = z
  .object({
    name: name(100),
    startDate: isoDate,
    endDate: isoDate,
    status: z.enum(['draft', 'active', 'closed']).default('draft'),
  })
  .refine((b) => b.endDate >= b.startDate, {
    message: 'End must be on or after start',
    path: ['endDate'],
  });
const cycles = crudResource({
  table: 'performance_cycles',
  label: 'Performance cycle',
  tag: 'Talent',
  read: P.SELF_SERVICE,
  manage: P.PERFORMANCE_MANAGE,
  create: cycleBody,
  patch: patchOf(
    z.object({
      name: name(100),
      startDate: isoDate,
      endDate: isoDate,
      status: z.enum(['draft', 'active', 'closed']),
    }),
  ),
  filters: { status: { column: 'x.status', schema: z.enum(['draft', 'active', 'closed']) } },
  search: ['x.name'],
  sort: { startDate: 'x.start_date', name: 'x.name' },
  defaultSort: 'startDate',
  defaultOrder: 'desc',
  select: (q) =>
    q.select(
      db.raw(
        `(SELECT count(*)::int FROM performance_reviews r WHERE r.cycle_id = x.id) as review_count`,
      ),
      db.raw(
        `(SELECT count(*)::int FROM performance_reviews r WHERE r.cycle_id = x.id AND r.status = 'completed') as completed_count`,
      ),
    ),
});

/* ── Training ── */
const programBody = z.object({
  code,
  title: name(150),
  description: text(2000),
  provider: text(150),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  capacity: z.number().int().min(1).max(10000).nullish(),
  certificationName: text(150),
  certificateValidityMonths: z.number().int().min(1).max(240).nullish(),
  status: z.enum(['planned', 'ongoing', 'completed', 'cancelled']).default('planned'),
});
const programs = crudResource({
  table: 'training_programs',
  label: 'Training program',
  tag: 'Talent',
  read: P.TRAINING_READ,
  manage: P.TRAINING_MANAGE,
  create: programBody,
  patch: patchOf(programBody),
  filters: {
    status: {
      column: 'x.status',
      schema: z.enum(['planned', 'ongoing', 'completed', 'cancelled']),
    },
  },
  search: ['x.title', 'x.code', 'x.provider'],
  sort: { startDate: 'x.start_date', title: 'x.title' },
  defaultSort: 'startDate',
  defaultOrder: 'desc',
  select: (q) =>
    q.select(
      db.raw(
        `(SELECT count(*)::int FROM training_enrollments en WHERE en.program_id = x.id AND en.status <> 'cancelled') as enrolled_count`,
      ),
    ),
});
const enrollments = crudResource({
  table: 'training_enrollments',
  label: 'Enrollment',
  tag: 'Talent',
  read: P.TRAINING_READ,
  manage: P.TRAINING_MANAGE,
  create: z.object({ programId: z.uuid(), employeeId: z.uuid() }),
  patch: patchOf(z.object({ status: z.enum(['enrolled', 'cancelled']) })),
  filters: {
    programId: { column: 'x.program_id', schema: z.uuid() },
    employeeId: { column: 'x.employee_id', schema: z.uuid() },
    status: {
      column: 'x.status',
      schema: z.enum(['enrolled', 'completed', 'failed', 'cancelled']),
    },
  },
  search: ['employee.first_name', 'employee.last_name', 'p.title'],
  sort: { createdAt: 'x.created_at', expires: 'x.certificate_expires_on' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
  select: (q) =>
    employeeJoin()(q)
      .join('training_programs as p', 'p.id', 'x.program_id')
      .select('p.title as program_title', 'p.certification_name'),
});

export const talentRoutes: FastifyPluginAsyncZod = async (app) => {
  vacancies.register(app, '/vacancies');
  applicants.register(app, '/applicants');
  applications.register(app, '/applications');
  interviews.register(app, '/interviews');
  const manageR = requirePermissions(P.RECRUITMENT_MANAGE);
  app.get(
    '/recruitment/pipeline',
    {
      preHandler: requirePermissions(P.RECRUITMENT_READ),
      schema: { tags, security, querystring: z.object({ vacancyId: z.uuid().optional() }) },
    },
    async (req, reply) =>
      sendSuccess(reply, await recruitmentService.pipeline(req.auth!, req.query.vacancyId)),
  );
  app.post(
    '/applications/:id/stage',
    {
      preHandler: manageR,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({ stage: z.enum(STAGES), notes: text(1000) }),
      },
    },
    async (req, reply) => {
      await recruitmentService.setStage(req.auth!, req.params.id, req.body);
      return sendSuccess(reply, await applications.service.get(req.auth!, req.params.id), {
        message: 'Stage updated',
      });
    },
  );
  app.post(
    '/applications/:id/offer',
    {
      preHandler: manageR,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          offerSalary: money,
          offerStartDate: isoDate,
          offerStatus: z.enum(['pending', 'accepted', 'declined']),
        }),
      },
    },
    async (req, reply) => {
      await recruitmentService.offer(req.auth!, req.params.id, req.body);
      return sendSuccess(reply, await applications.service.get(req.auth!, req.params.id), {
        message: 'Offer saved',
      });
    },
  );
  app.post(
    '/applications/:id/hire',
    {
      preHandler: [...manageR, ...requirePermissions(P.EMPLOYEES_CREATE).slice(1)],
      schema: {
        tags,
        security,
        summary: 'Convert an accepted offer into an employee',
        params: idParams,
        body: z.object({
          employeeNumber: z
            .string()
            .trim()
            .min(1)
            .max(30)
            .regex(/^[A-Za-z0-9._/-]+$/),
          joiningDate: isoDate.optional(),
          departmentId: z.uuid().nullish(),
          designationId: z.uuid().nullish(),
          branchId: z.uuid().nullish(),
          managerId: z.uuid().nullish(),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await recruitmentService.hire(req.auth!, req.params.id, req.body), {
        statusCode: 201,
        message: 'Employee created from applicant',
      }),
  );

  cycles.register(app, '/performance-cycles');
  const manageP = requirePermissions(P.PERFORMANCE_MANAGE);
  app.post(
    '/performance-cycles/:id/launch',
    { preHandler: manageP, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await performanceService.launch(req.auth!, req.params.id), {
        message: 'Reviews created',
      }),
  );
  app.get(
    '/performance-reviews',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        querystring: z.object({
          cycleId: z.uuid().optional(),
          status: z.enum(['self_review', 'manager_review', 'completed']).optional(),
          mine: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await performanceService.list(req.auth!, req.query)),
  );
  app.get(
    '/performance-reviews/:id',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await performanceService.get(req.auth!, req.params.id)),
  );
  app.post(
    '/performance-reviews/:id/self',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          selfRating: rating,
          selfComments: text(5000),
          submit: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await performanceService.selfAssess(req.auth!, req.params.id, req.body), {
        message: 'Self-assessment saved',
      }),
  );
  app.post(
    '/performance-reviews/:id/manager',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          managerRating: rating,
          managerComments: text(5000),
          finalRating: rating.nullish(),
          submit: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await performanceService.managerAssess(req.auth!, req.params.id, req.body),
        { message: 'Evaluation saved' },
      ),
  );
  const goalBody = z.object({
    title: name(200),
    kpi: text(200),
    target: text(100),
    weight: z.number().int().min(0).max(100).default(0),
    achievement: text(200),
    rating: rating.nullish(),
  });
  app.post(
    '/performance-reviews/:id/goals',
    { preHandler: authenticate, schema: { tags, security, params: idParams, body: goalBody } },
    async (req, reply) =>
      sendSuccess(
        reply,
        await performanceService.saveGoal(req.auth!, req.params.id, null, req.body),
        { statusCode: 201, message: 'Goal added' },
      ),
  );
  app.put(
    '/performance-reviews/:id/goals/:goalId',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        params: z.object({ id: z.uuid(), goalId: z.uuid() }),
        body: goalBody,
      },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await performanceService.saveGoal(req.auth!, req.params.id, req.params.goalId, req.body),
        { message: 'Goal saved' },
      ),
  );
  app.delete(
    '/performance-reviews/:id/goals/:goalId',
    {
      preHandler: authenticate,
      schema: { tags, security, params: z.object({ id: z.uuid(), goalId: z.uuid() }) },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await performanceService.removeGoal(req.auth!, req.params.id, req.params.goalId),
        { message: 'Goal removed' },
      ),
  );
  app.get(
    '/employees/:id/feedback',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await performanceService.feedback(req.auth!, req.params.id)),
  );
  app.post(
    '/employees/:id/feedback',
    {
      preHandler: requirePermissions(P.SELF_SERVICE),
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          content: z.string().trim().min(3).max(2000),
          cycleId: z.uuid().nullish(),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await performanceService.addFeedback(req.auth!, req.params.id, req.body), {
        statusCode: 201,
        message: 'Feedback recorded',
      }),
  );

  programs.register(app, '/training-programs');
  enrollments.register(app, '/training-enrollments');
  const manageT = requirePermissions(P.TRAINING_MANAGE);
  app.post(
    '/training-programs/:id/enroll',
    {
      preHandler: manageT,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({ employeeIds: z.array(z.uuid()).min(1).max(500) }),
      },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await trainingService.enrollMany(req.auth!, req.params.id, req.body.employeeIds),
        { message: 'Employees enrolled' },
      ),
  );
  app.post(
    '/training-enrollments/:id/complete',
    {
      preHandler: manageT,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          status: z.enum(['completed', 'failed']),
          completedOn: isoDate,
          score: z.number().int().min(0).max(100).nullish(),
          certificateFileId: z.uuid().nullish(),
        }),
      },
    },
    async (req, reply) => {
      await trainingService.complete(req.auth!, req.params.id, req.body);
      return sendSuccess(reply, await enrollments.service.get(req.auth!, req.params.id), {
        message: 'Training outcome recorded',
      });
    },
  );
};
