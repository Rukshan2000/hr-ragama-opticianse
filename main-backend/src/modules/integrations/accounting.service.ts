import { createHmac } from 'node:crypto';
import { env } from '../../config/env';
import { db, withTransaction } from '../../database/knex';
import { AppError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { SYSTEM_CODES } from '../payroll/payroll-calc';

/**
 * Two-way link with the accounting system (Invobiz).
 *  - HR → accounting: a locked payroll run is pushed as totals per branch × department ×
 *    component (no employee data), signed with HMAC-SHA256 over the raw body.
 *  - accounting → HR: branches/departments are pulled so both sides use the same codes,
 *    and the posting status of a pushed run is read back.
 */

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const amt = (c: number) => (c / 100).toFixed(2);
const sign = (data: string) =>
  createHmac('sha256', env.ACCOUNTING_SHARED_SECRET!).update(data).digest('hex');

function config() {
  if (!env.ACCOUNTING_API_URL || !env.ACCOUNTING_SHARED_SECRET)
    throw new AppError(503, 'The accounting integration is not configured', 'NOT_CONFIGURED');
  return env.ACCOUNTING_API_URL.replace(/\/$/, '');
}

/** Calls accounting; turns its error into a message the HR user can act on. */
async function call(tenantId: string, path: string, init: RequestInit = {}) {
  const base = config();
  const ts = String(Math.floor(Date.now() / 1000));
  const url = `${base}/integrations/hr${path}${path.includes('?') ? '&' : '?'}hrTenantId=${tenantId}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'x-timestamp': ts,
        'x-signature': sign(`${ts}.${tenantId}`),
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new AppError(502, `Accounting is unreachable: ${(err as Error).message}`, 'UPSTREAM');
  }
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string };
  if (!res.ok) {
    const hint =
      res.status === 404 ? ` — in accounting, set this company's HR tenant ID to ${tenantId}` : '';
    throw new AppError(502, `Accounting: ${body.message ?? res.statusText}${hint}`, 'UPSTREAM');
  }
  return body.data;
}

type Line = {
  branchCode: string | null;
  departmentCode: string | null;
  type: string;
  code?: string;
  amount: string;
};

/** The v1 payload accounting posts from. Balanced by construction: earnings = gross. */
export async function buildPayload(tenantId: string, runId: string) {
  const run = await tenantScope(db, 'payroll_runs', tenantId).where({ id: runId }).first();
  if (!run) throw new NotFoundError('Payroll run');
  const slips = await tenantScope(db, 'payslips as p', tenantId)
    .join('employees as e', 'e.id', 'p.employee_id')
    .leftJoin('branches as b', 'b.id', 'e.branch_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .where('p.run_id', runId)
    .select('p.*', 'b.code as branch_code', 'd.code as department_code');
  // Payslips calculated before codes were stored carry only labels: map names back to codes.
  const byName = new Map<string, string>(
    (await tenantScope(db, 'salary_components', tenantId).select('name', 'code')).map(
      (c: { name: string; code: string }) => [c.name, c.code],
    ),
  );
  const legacySystem = (label: string) =>
    label.startsWith('EPF employee') || label === 'APIT' || label === 'Loan / advance recovery';
  const system = new Set<string>(Object.values(SYSTEM_CODES));

  const totals = new Map<string, number>();
  const add = (s: Record<string, unknown>, type: string, c: number, code?: string) => {
    if (!c) return;
    const k = JSON.stringify([
      s.branch_code ?? null,
      s.department_code ?? null,
      type,
      code ?? null,
    ]);
    totals.set(k, (totals.get(k) ?? 0) + c);
  };
  for (const s of slips) {
    const earnings = s.earnings as { label: string; code?: string; amount: number }[];
    const deductions = s.deductions as { label: string; code?: string; amount: number }[];
    let listed = 0;
    for (const e of earnings) {
      const code =
        e.code ?? byName.get(e.label) ?? (e.label.startsWith('Overtime (') ? 'OT' : 'ADJ-EARN');
      add(s, 'earning', cents(e.amount), code);
      listed += cents(e.amount);
    }
    add(s, 'earning', cents(s.gross_pay) - listed, 'BASIC'); // basic after unpaid leave
    for (const d of deductions) {
      if (d.code ? system.has(d.code) : legacySystem(d.label)) continue; // sent by type below
      add(s, 'deduction', cents(d.amount), d.code ?? byName.get(d.label) ?? 'ADJ-DED');
    }
    add(s, 'epf_employee', cents(s.epf_employee));
    add(s, 'epf_employer', cents(s.epf_employer));
    add(s, 'etf', cents(s.etf));
    add(s, 'apit', cents(s.apit));
    add(s, 'loan_recovery', cents(s.loan_deduction));
    add(s, 'net_pay', cents(s.net_pay));
  }
  const lines: Line[] = [...totals].map(([k, c]) => {
    const [branchCode, departmentCode, type, code] = JSON.parse(k);
    return { branchCode, departmentCode, type, ...(code && { code }), amount: amt(c) };
  });
  return { version: 1, hrTenantId: tenantId, runId, year: run.year, month: run.month, lines };
}

const record = (runId: string, status: string, message: string | null) =>
  db('payroll_runs')
    .where({ id: runId })
    .update({
      accounting_status: status,
      accounting_message: message?.slice(0, 500) ?? null,
      accounting_synced_at: db.fn.now(),
    });

export const accountingService = {
  enabled: () => Boolean(env.ACCOUNTING_API_URL && env.ACCOUNTING_SHARED_SECRET),

  /** Pushes a locked run. Safe to repeat: accounting ignores a run it already has. */
  async sendRun(tenantId: string, runId: string) {
    const run = await tenantScope(db, 'payroll_runs', tenantId).where({ id: runId }).first();
    if (!run) throw new NotFoundError('Payroll run');
    if (run.status !== 'locked')
      throw new ConflictError('Only locked payrolls can be sent to accounting');
    const raw = JSON.stringify(await buildPayload(tenantId, runId));
    try {
      const base = config();
      let res: Response;
      try {
        res = await fetch(`${base}/integrations/hr/payroll-runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-signature': sign(raw) },
          body: raw,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new AppError(502, `Accounting is unreachable: ${(err as Error).message}`, 'UPSTREAM');
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        const hint =
          res.status === 404
            ? ` — in accounting, set this company's HR tenant ID to ${tenantId}`
            : '';
        throw new AppError(502, `Accounting: ${body.message ?? res.statusText}${hint}`, 'UPSTREAM');
      }
      await record(runId, 'sent', body.message ?? null);
    } catch (err) {
      await record(runId, 'failed', (err as Error).message);
      throw err;
    }
    return accountingService.status(tenantId, runId);
  },

  /** Refreshes the run's status from accounting (needs_mapping / ready / posted …). */
  async status(tenantId: string, runId: string) {
    const run = await tenantScope(db, 'payroll_runs', tenantId).where({ id: runId }).first();
    if (!run) throw new NotFoundError('Payroll run');
    if (run.accounting_status && run.accounting_status !== 'failed') {
      const r = (await call(tenantId, `/payroll-runs/${runId}`)) as {
        status: string;
        statusReason: string | null;
      };
      await record(runId, r.status, r.statusReason);
    }
    const row = await db('payroll_runs').where({ id: runId }).first();
    return {
      status: row.accounting_status as string | null,
      message: row.accounting_message as string | null,
      syncedAt: row.accounting_synced_at as Date | null,
    };
  },

  /** Imports accounting's branches and departments by code: new ones added, names updated. */
  async importOrg(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const org = (await call(tenantId, '/org-structure')) as Record<
      'branches' | 'departments',
      { code: string; name: string; isActive: boolean }[]
    >;
    const result = { added: 0, updated: 0 };
    await withTransaction(async (trx) => {
      for (const table of ['branches', 'departments'] as const) {
        for (const u of org[table]) {
          const existing = await tenantScope(trx, table, tenantId).where({ code: u.code }).first();
          if (existing) {
            if (existing.name !== u.name || existing.is_active !== u.isActive) {
              await trx(table)
                .where({ id: existing.id })
                .update({ name: u.name, is_active: u.isActive });
              result.updated++;
            }
          } else {
            await trx(table).insert({
              tenant_id: tenantId,
              code: u.code,
              name: u.name,
              is_active: u.isActive,
            });
            result.added++;
          }
        }
      }
      await audit(trx, auth, 'organization.import_accounting', 'organization', null, result);
    });
    return result;
  },
};
