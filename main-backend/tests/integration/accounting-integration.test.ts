import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { API, bearer, register, setupTestApp, type Session } from '../helpers/test-app';

const app = setupTestApp();
type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (s: Session, method: M, url: string, payload?: object) =>
  app().inject({ method, url: `${API}${url}`, headers: bearer(s), payload });
const ok = async (s: Session, method: M, url: string, payload?: object) => {
  const r = await call(s, method, url, payload);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.json().data;
};

const SECRET = 'shared-secret-shared-secret-shared-secret';
const hmac = (s: string) => createHmac('sha256', SECRET).update(s).digest('hex');

/** Stand-in for the accounting API: checks signatures like the real one and records pushes. */
const pushes: { version: number; lines: { type: string; code?: string; amount: string }[] }[] = [];
let linked = true;
const server = createServer(async (req: IncomingMessage, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const url = new URL(req.url!, 'http://x');
  const send = (status: number, data: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (!linked) return send(404, { message: 'No company is linked to this HR tenant' });
  if (req.method === 'POST') {
    if (req.headers['x-signature'] !== hmac(raw))
      return send(401, { message: 'Invalid signature' });
    pushes.push(JSON.parse(raw));
    return send(202, { data: { duplicate: false }, message: 'Payroll run received' });
  }
  const ts = String(req.headers['x-timestamp']);
  if (req.headers['x-signature'] !== hmac(`${ts}.${url.searchParams.get('hrTenantId')}`))
    return send(401, { message: 'Invalid signature' });
  if (url.pathname.endsWith('/org-structure'))
    return send(200, {
      data: {
        branches: [{ code: 'HO', name: 'Head Office', isActive: true }],
        departments: [{ code: 'FIN', name: 'Finance', isActive: true }],
      },
    });
  return send(200, { data: { status: 'needs_mapping', statusReason: 'Map: TRN' } });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  env.ACCOUNTING_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  env.ACCOUNTING_SHARED_SECRET = SECRET;
});
afterAll(() => {
  env.ACCOUNTING_API_URL = undefined;
  env.ACCOUNTING_SHARED_SECRET = undefined;
  server.close();
});

describe('accounting integration', () => {
  it('imports org codes, pushes a balanced locked run, retries and reads back status', async () => {
    const admin = await register(app(), 'acc-admin@x.lk', 'Org acc');

    // accounting → HR: branches and departments by code, idempotent
    expect(await ok(admin, 'POST', '/organization/import-from-accounting')).toEqual({
      added: 2,
      updated: 0,
    });
    expect(await ok(admin, 'POST', '/organization/import-from-accounting')).toEqual({
      added: 0,
      updated: 0,
    });
    const branch = (await ok(admin, 'GET', '/organization/branches')).find(
      (b: { code: string }) => b.code === 'HO',
    );
    const dept = (await ok(admin, 'GET', '/organization/departments')).find(
      (d: { code: string }) => d.code === 'FIN',
    );

    const emp = await ok(admin, 'POST', '/employees', {
      employeeNumber: 'E1',
      firstName: 'Ann',
      lastName: 'Test',
      joiningDate: '2025-01-06',
      status: 'active',
      branchId: branch.id,
      departmentId: dept.id,
    });
    await ok(admin, 'POST', '/payroll-policies', {
      effectiveFrom: '2026-01-01',
      epfEmployeeRate: 8,
      epfEmployerRate: 12,
      etfRate: 3,
      apitBrackets: [
        { upTo: 150000, rate: 0 },
        { upTo: null, rate: 6 },
      ],
    });
    const trn = await ok(admin, 'POST', '/salary-components', {
      code: 'TRN',
      name: 'Transport',
      kind: 'earning',
    });
    const welfare = await ok(admin, 'POST', '/salary-components', {
      code: 'WEL',
      name: 'Welfare',
      kind: 'deduction',
    });
    await ok(admin, 'POST', '/salaries', {
      employeeId: emp.id,
      effectiveFrom: '2026-01-01',
      basicSalary: 200000,
      items: [
        { componentId: trn.id, amount: 10000 },
        { componentId: welfare.id, amount: 500 },
      ],
    });
    await ok(admin, 'POST', '/payroll-adjustments', {
      employeeId: emp.id,
      year: 2026,
      month: 3,
      kind: 'earning',
      label: 'Bonus',
      amount: 5000,
    });
    const run = await ok(admin, 'POST', '/payroll-runs', { year: 2026, month: 3 });
    await ok(admin, 'POST', `/payroll-runs/${run.id}/calculate`);
    await ok(admin, 'POST', `/payroll-runs/${run.id}/approve`);
    expect(
      (await call(admin, 'POST', `/payroll-runs/${run.id}/send-to-accounting`)).statusCode,
    ).toBe(409); // not locked yet

    // Accounting not linked yet: lock still succeeds, the failure is recorded with a fix hint
    linked = false;
    const locked = await ok(admin, 'POST', `/payroll-runs/${run.id}/lock`);
    expect(locked).toMatchObject({ status: 'locked', accountingStatus: 'failed' });
    expect(locked.accountingMessage).toMatch(new RegExp(`HR tenant ID to ${admin.tenantId}`));
    expect(pushes).toHaveLength(0);

    linked = true;
    await ok(admin, 'POST', `/payroll-runs/${run.id}/send-to-accounting`);
    expect(pushes).toHaveLength(1);
    const p = pushes[0]!;
    expect(p.version).toBe(1);
    const sum = (types: string[]) =>
      p.lines.filter((l) => types.includes(l.type)).reduce((s, l) => s + Number(l.amount), 0);
    const code = (c: string) => p.lines.find((l) => l.code === c)?.amount;
    expect(code('BASIC')).toBe('200000.00');
    expect(code('TRN')).toBe('10000.00');
    expect(code('ADJ-EARN')).toBe('5000.00');
    expect(code('WEL')).toBe('500.00');
    expect(p.lines.every((l) => l.code !== 'EPF_EE' && l.code !== 'APIT')).toBe(true);
    // Debits (earnings) = credits (deductions + EPF employee + APIT + loans + net)
    expect(sum(['earning'])).toBe(215000);
    expect(sum(['deduction', 'epf_employee', 'apit', 'loan_recovery', 'net_pay'])).toBe(215000);
    expect(JSON.stringify(p)).not.toContain(emp.id); // no employee data crosses over
    expect((p.lines[0] as { branchCode?: string }).branchCode).toBe('HO');

    // accounting → HR: posting status read back
    expect(await ok(admin, 'GET', `/payroll-runs/${run.id}/accounting-status`)).toMatchObject({
      status: 'needs_mapping',
      message: 'Map: TRN',
    });
  });
});
