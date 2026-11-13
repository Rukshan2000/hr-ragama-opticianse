import { db, withTransaction } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { findMyEmployee } from '../hr-common/me';
import { employeesService } from '../employees/employees.service';
import { notify } from '../notifications/notifications.service';
import { addDays } from '../time/attendance-calc';

/* ── Recruitment ──────────────────────────────────────────── */

const STAGE_FLOW: Record<string, string[]> = {
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'offered', 'rejected', 'withdrawn'],
  interview: ['offered', 'rejected', 'withdrawn'],
  offered: ['interview', 'rejected', 'withdrawn'], // hired only via the hire action
  hired: [],
  rejected: ['screening'],
  withdrawn: [],
};

export const recruitmentService = {
  async setStage(auth: AuthContext, id: string, input: { stage: string; notes?: string | null }) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const a = await tenantScope(trx, 'job_applications', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!a) throw new NotFoundError('Application');
      if (!STAGE_FLOW[a.stage]!.includes(input.stage))
        throw new BadRequestError(`Cannot move from ${a.stage} to ${input.stage}`);
      await trx('job_applications')
        .where({ id })
        .update({ stage: input.stage, ...(input.notes !== undefined && { notes: input.notes }) });
      await audit(trx, auth, 'application.stage', 'job_applications', id, {
        from: a.stage,
        to: input.stage,
      });
    });
  },

  async offer(
    auth: AuthContext,
    id: string,
    input: {
      offerSalary: number;
      offerStartDate: string;
      offerStatus: 'pending' | 'accepted' | 'declined';
    },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const a = await tenantScope(trx, 'job_applications', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!a) throw new NotFoundError('Application');
      if (['hired', 'withdrawn'].includes(a.stage))
        throw new ConflictError(`The application is ${a.stage}`);
      await trx('job_applications')
        .where({ id })
        .update({
          stage: input.offerStatus === 'declined' ? 'rejected' : 'offered',
          offer_salary: input.offerSalary,
          offer_start_date: input.offerStartDate,
          offer_status: input.offerStatus,
        });
      await audit(trx, auth, 'application.offer', 'job_applications', id, input);
    });
  },

  /**
   * Converts an accepted offer into an employee. The applicant's details are copied once; if an
   * employee with the same email exists the hire is refused instead of creating a duplicate.
   */
  async hire(
    auth: AuthContext,
    id: string,
    input: {
      employeeNumber: string;
      joiningDate?: string;
      departmentId?: string | null;
      designationId?: string | null;
      branchId?: string | null;
      managerId?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const a = await tenantScope(db, 'job_applications as a', tenantId)
      .join('applicants as p', 'p.id', 'a.applicant_id')
      .join('vacancies as v', 'v.id', 'a.vacancy_id')
      .where('a.id', id)
      .first(
        'a.*',
        'p.first_name',
        'p.last_name',
        'p.email',
        'p.phone',
        'v.department_id as v_department',
        'v.designation_id as v_designation',
        'v.branch_id as v_branch',
        'v.employment_type',
        'v.openings',
      );
    if (!a) throw new NotFoundError('Application');
    if (a.employee_id || a.stage === 'hired')
      throw new ConflictError('This applicant was already hired');
    if (a.stage !== 'offered' || a.offer_status !== 'accepted')
      throw new ConflictError('Only applicants with an accepted offer can be hired');
    const dup = await tenantScope(db, 'employees', tenantId)
      .whereNull('deleted_at')
      .whereRaw('lower(email) = lower(?)', [a.email])
      .first('id');
    if (dup) throw new ConflictError('An employee with this email already exists');

    const employee = await employeesService.create(auth, {
      employeeNumber: input.employeeNumber,
      firstName: a.first_name,
      lastName: a.last_name,
      email: a.email,
      phone: a.phone,
      joiningDate: input.joiningDate ?? a.offer_start_date,
      employmentType: a.employment_type,
      status: 'onboarding',
      departmentId: input.departmentId ?? a.v_department,
      designationId: input.designationId ?? a.v_designation,
      branchId: input.branchId ?? a.v_branch,
      managerId: input.managerId ?? null,
    } as Parameters<typeof employeesService.create>[1]);

    await withTransaction(async (trx) => {
      const locked = await tenantScope(trx, 'job_applications', tenantId)
        .where({ id })
        .forUpdate()
        .first('employee_id');
      if (locked.employee_id) throw new ConflictError('This applicant was already hired');
      await trx('job_applications')
        .where({ id })
        .update({ stage: 'hired', employee_id: employee.id });
      // Carry the CV over as an employee document.
      const ap = await tenantScope(trx, 'applicants', tenantId)
        .where({ id: a.applicant_id })
        .first('cv_file_id');
      if (ap?.cv_file_id) {
        await trx('files').where({ id: ap.cv_file_id }).update({ employee_id: employee.id });
        await trx('employee_documents').insert({
          tenant_id: tenantId,
          employee_id: employee.id,
          file_id: ap.cv_file_id,
          category: 'other',
          title: 'CV (from recruitment)',
          created_by: auth.userId,
        });
      }
      const hired = await tenantScope(trx, 'job_applications', tenantId)
        .where({ vacancy_id: a.vacancy_id, stage: 'hired' })
        .count<{ count: string }[]>({ count: '*' })
        .first();
      if (Number(hired?.count) >= a.openings)
        await tenantScope(trx, 'vacancies', tenantId)
          .where({ id: a.vacancy_id })
          .update({ status: 'filled' });
      await audit(trx, auth, 'application.hire', 'job_applications', id, {
        employeeId: employee.id,
      });
    });
    return employee;
  },

  async pipeline(auth: AuthContext, vacancyId?: string) {
    const tenantId = requireTenantId(auth);
    const rows = await tenantScope(db, 'job_applications as a', tenantId)
      .modify((b) => vacancyId && b.where('a.vacancy_id', vacancyId))
      .groupBy('a.stage')
      .select('a.stage', db.raw('count(*)::int as count'));
    return Object.fromEntries(
      rows.map((r: { stage: string; count: number }) => [r.stage, r.count]),
    );
  },
};

/* ── Performance ──────────────────────────────────────────── */

const reviewQuery = (tenantId: string) =>
  tenantScope(db, 'performance_reviews as r', tenantId)
    .join('performance_cycles as c', 'c.id', 'r.cycle_id')
    .join('employees as e', 'e.id', 'r.employee_id')
    .leftJoin('employees as m', 'm.id', 'r.reviewer_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(
      'r.*',
      'c.name as cycle_name',
      'c.status as cycle_status',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'd.name as department_name',
      db.raw(`m.first_name || ' ' || m.last_name as reviewer_name`),
    );

async function reviewAccess(
  auth: AuthContext,
  r: { employee_id: string; reviewer_id: string | null },
) {
  const me = await findMyEmployee(auth);
  return {
    isHr: auth.permissions.has(P.PERFORMANCE_MANAGE),
    isSelf: me?.id === r.employee_id,
    isReviewer: Boolean(me && me.id === r.reviewer_id),
    canRead:
      auth.permissions.has(P.PERFORMANCE_READ) ||
      me?.id === r.employee_id ||
      (me && me.id === r.reviewer_id),
  };
}

export const performanceService = {
  /** Creates a review per active employee (reviewer = their manager). Idempotent. */
  async launch(auth: AuthContext, cycleId: string) {
    const tenantId = requireTenantId(auth);
    return withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'performance_cycles', tenantId)
        .where({ id: cycleId })
        .forUpdate()
        .first();
      if (!c) throw new NotFoundError('Performance cycle');
      if (c.status === 'closed') throw new ConflictError('This cycle is closed');
      const employees = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .whereIn('status', ['probation', 'active', 'on_notice'])
        .where('joining_date', '<=', c.end_date)
        .select('id', 'manager_id', 'user_id');
      const rows = employees.map((e) => ({
        tenant_id: tenantId,
        cycle_id: cycleId,
        employee_id: e.id,
        reviewer_id: e.manager_id,
      }));
      const created = rows.length
        ? await trx('performance_reviews')
            .insert(rows)
            .onConflict(['tenant_id', 'cycle_id', 'employee_id'])
            .ignore()
            .returning('employee_id')
        : [];
      await trx('performance_cycles').where({ id: cycleId }).update({ status: 'active' });
      await audit(trx, auth, 'performance.launch', 'performance_cycles', cycleId, {
        created: created.length,
      });
      return { created: created.length };
    });
  },

  async list(auth: AuthContext, q: { cycleId?: string; status?: string; mine?: boolean }) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    const all = auth.permissions.has(P.PERFORMANCE_READ) && !q.mine;
    if (!all && !me) return [];
    const rows = await reviewQuery(tenantId)
      .modify((b) => {
        if (q.cycleId) b.where('r.cycle_id', q.cycleId);
        if (q.status) b.where('r.status', q.status);
        if (!all) b.where((w) => w.where('r.employee_id', me!.id).orWhere('r.reviewer_id', me!.id));
      })
      .orderBy([{ column: 'c.start_date', order: 'desc' }, { column: 'e.first_name' }])
      .limit(500);
    return rows.map(toCamel);
  },

  async get(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const r = await reviewQuery(tenantId).where('r.id', id).first();
    if (!r) throw new NotFoundError('Review');
    const acc = await reviewAccess(auth, r);
    if (!acc.canRead) throw new NotFoundError('Review');
    const goals = await tenantScope(db, 'performance_goals', tenantId)
      .where({ review_id: id })
      .orderBy('created_at');
    return { ...toCamel(r), goals: goals.map(toCamel), access: acc };
  },

  async selfAssess(
    auth: AuthContext,
    id: string,
    input: { selfRating: number; selfComments?: string | null; submit: boolean },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const r = await tenantScope(trx, 'performance_reviews', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!r) throw new NotFoundError('Review');
      if (!(await reviewAccess(auth, r)).isSelf) throw new NotFoundError('Review');
      if (r.status !== 'self_review')
        throw new ConflictError('The self-assessment was already submitted');
      await trx('performance_reviews')
        .where({ id })
        .update({
          self_rating: input.selfRating,
          self_comments: input.selfComments ?? null,
          status: input.submit ? 'manager_review' : 'self_review',
        });
    });
    return performanceService.get(auth, id);
  },

  async managerAssess(
    auth: AuthContext,
    id: string,
    input: {
      managerRating: number;
      managerComments?: string | null;
      finalRating?: number | null;
      submit: boolean;
    },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const r = await tenantScope(trx, 'performance_reviews', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!r) throw new NotFoundError('Review');
      const acc = await reviewAccess(auth, r);
      if (!acc.isReviewer && !acc.isHr)
        throw new ForbiddenError('Only the reviewer can assess this review');
      if (r.status === 'completed') throw new ConflictError('This review is completed');
      await trx('performance_reviews')
        .where({ id })
        .update({
          manager_rating: input.managerRating,
          manager_comments: input.managerComments ?? null,
          final_rating: input.finalRating ?? input.managerRating,
          status: input.submit ? 'completed' : r.status,
        });
      await audit(trx, auth, 'performance.assess', 'performance_reviews', id, {
        submit: input.submit,
      });
    });
    return performanceService.get(auth, id);
  },

  async saveGoal(
    auth: AuthContext,
    reviewId: string,
    goalId: string | null,
    input: Record<string, unknown>,
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const r = await tenantScope(trx, 'performance_reviews', tenantId)
        .where({ id: reviewId })
        .forUpdate()
        .first();
      if (!r) throw new NotFoundError('Review');
      const acc = await reviewAccess(auth, r);
      if (!acc.isSelf && !acc.isReviewer && !acc.isHr) throw new NotFoundError('Review');
      if (r.status === 'completed') throw new ConflictError('This review is completed');
      const data = {
        title: input.title,
        kpi: input.kpi ?? null,
        target: input.target ?? null,
        weight: input.weight ?? 0,
        achievement: input.achievement ?? null,
        rating: input.rating ?? null,
      };
      if (goalId) {
        if (
          !(await tenantScope(trx, 'performance_goals', tenantId)
            .where({ id: goalId, review_id: reviewId })
            .update(data))
        )
          throw new NotFoundError('Goal');
      } else
        await trx('performance_goals').insert({
          ...data,
          tenant_id: tenantId,
          review_id: reviewId,
        });
      const total = await tenantScope(trx, 'performance_goals', tenantId)
        .where({ review_id: reviewId })
        .sum<{ s: string }[]>({ s: 'weight' })
        .first();
      if (Number(total?.s) > 100)
        throw new BadRequestError('Goal weights cannot add up to more than 100%');
    });
    return performanceService.get(auth, reviewId);
  },

  async removeGoal(auth: AuthContext, reviewId: string, goalId: string) {
    const tenantId = requireTenantId(auth);
    const r = await tenantScope(db, 'performance_reviews', tenantId)
      .where({ id: reviewId })
      .first();
    if (!r) throw new NotFoundError('Review');
    const acc = await reviewAccess(auth, r);
    if (!acc.isSelf && !acc.isReviewer && !acc.isHr) throw new NotFoundError('Review');
    if (r.status === 'completed') throw new ConflictError('This review is completed');
    if (
      !(await tenantScope(db, 'performance_goals', tenantId)
        .where({ id: goalId, review_id: reviewId })
        .delete())
    )
      throw new NotFoundError('Goal');
    return performanceService.get(auth, reviewId);
  },

  async feedback(auth: AuthContext, employeeId: string) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    if (!auth.permissions.has(P.PERFORMANCE_READ) && me?.id !== employeeId) {
      const managed =
        me &&
        (await tenantScope(db, 'employees', tenantId)
          .where({ id: employeeId, manager_id: me.id })
          .first('id'));
      if (!managed) throw new NotFoundError('Employee');
    }
    return tenantScope(db, 'performance_feedback as f', tenantId)
      .leftJoin('users as u', 'u.id', 'f.author_id')
      .where('f.employee_id', employeeId)
      .orderBy('f.created_at', 'desc')
      .select('f.id', 'f.content', 'f.created_at as createdAt', 'u.name as authorName');
  },

  async addFeedback(
    auth: AuthContext,
    employeeId: string,
    input: { content: string; cycleId?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    if (
      !(await tenantScope(db, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .first('id'))
    )
      throw new NotFoundError('Employee');
    const me = await findMyEmployee(auth);
    if (me?.id === employeeId)
      throw new BadRequestError('Feedback is given to colleagues, not yourself');
    await db('performance_feedback').insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      author_id: auth.userId,
      cycle_id: input.cycleId ?? null,
      content: input.content,
    });
    return performanceService.feedback(
      { ...auth, permissions: new Set([...auth.permissions, P.PERFORMANCE_READ]) },
      employeeId,
    );
  },
};

/* ── Training ─────────────────────────────────────────────── */

export const trainingService = {
  async complete(
    auth: AuthContext,
    enrollmentId: string,
    input: {
      status: 'completed' | 'failed';
      completedOn: string;
      score?: number | null;
      certificateFileId?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const en = await tenantScope(trx, 'training_enrollments as en', tenantId)
        .join('training_programs as p', 'p.id', 'en.program_id')
        .where('en.id', enrollmentId)
        .forUpdate('en')
        .first('en.*', 'p.certificate_validity_months', 'p.certification_name');
      if (!en) throw new NotFoundError('Enrollment');
      if (en.status === 'cancelled') throw new ConflictError('This enrollment was cancelled');
      if (input.certificateFileId) {
        const f = await tenantScope(trx, 'files', tenantId)
          .where({ id: input.certificateFileId, purpose: 'certificate' })
          .first('id');
        if (!f) throw new BadRequestError('Upload the certificate first');
        await trx('files').where({ id: f.id }).update({ employee_id: en.employee_id });
      }
      let expires: string | null = null;
      if (input.status === 'completed' && en.certificate_validity_months) {
        const d = new Date(`${input.completedOn}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + en.certificate_validity_months);
        expires = addDays(d.toISOString().slice(0, 10), -1);
      }
      await trx('training_enrollments')
        .where({ id: enrollmentId })
        .update({
          status: input.status,
          completed_on: input.completedOn,
          score: input.score ?? null,
          certificate_expires_on: expires,
          certificate_file_id: input.certificateFileId ?? en.certificate_file_id,
        });
      await audit(trx, auth, 'training.complete', 'training_enrollments', enrollmentId, input);
    });
  },

  async enrollMany(auth: AuthContext, programId: string, employeeIds: string[]) {
    const tenantId = requireTenantId(auth);
    return withTransaction(async (trx) => {
      const p = await tenantScope(trx, 'training_programs', tenantId)
        .where({ id: programId })
        .forUpdate()
        .first();
      if (!p) throw new NotFoundError('Training program');
      if (['completed', 'cancelled'].includes(p.status))
        throw new ConflictError(`This program is ${p.status}`);
      const valid = (await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .whereIn('id', employeeIds)
        .pluck('id')) as string[];
      if (valid.length !== employeeIds.length) throw new BadRequestError('Unknown employee');
      const inserted = await trx('training_enrollments')
        .insert(
          valid.map((employee_id) => ({ tenant_id: tenantId, program_id: programId, employee_id })),
        )
        .onConflict(['tenant_id', 'program_id', 'employee_id'])
        .ignore()
        .returning('id');
      if (p.capacity) {
        const n = await tenantScope(trx, 'training_enrollments', tenantId)
          .where({ program_id: programId })
          .whereNot('status', 'cancelled')
          .count<{ c: string }[]>({ c: '*' })
          .first();
        if (Number(n?.c) > p.capacity)
          throw new ConflictError(`This program is limited to ${p.capacity} participants`);
      }
      return { enrolled: inserted.length };
    });
  },

  /** Notifies employees and HR of certificates expiring within 30 days (deduplicated). */
  async remindExpiring() {
    const rows = await db('training_enrollments as en')
      .join('training_programs as p', 'p.id', 'en.program_id')
      .join('employees as e', 'e.id', 'en.employee_id')
      .where('en.status', 'completed')
      .whereRaw(`en.certificate_expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`)
      .select('en.id', 'en.tenant_id', 'en.certificate_expires_on', 'p.title', 'e.user_id');
    for (const r of rows)
      await notify({
        tenantId: r.tenant_id,
        userIds: [r.user_id],
        type: 'announcement',
        title: `Certificate "${r.title}" expires on ${r.certificate_expires_on}`,
        link: '/me?tab=training',
        dedupeKey: `cert-expiry:${r.id}:${r.certificate_expires_on}`,
      });
  },
};
