import { describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createMember,
  register,
  setupTestApp,
  type Session,
} from '../helpers/test-app';

const app = setupTestApp();
const call = (
  s: Session,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => app().inject({ method, url: `${API}${url}`, headers: bearer(s), payload });

const base = { firstName: 'Nimal', lastName: 'Perera', joiningDate: '2025-01-06' };
async function hire(s: Session, employeeNumber: string, extra: object = {}) {
  const r = await call(s, 'POST', '/employees', { ...base, employeeNumber, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().data as { id: string; status: string };
}

describe('employees', () => {
  it('creates employees with unique numbers, references and history', async () => {
    const a = await register(app(), 'emp-a@a.com', 'Emp A');
    const dep = (
      await call(a, 'POST', '/organization/departments', { code: 'ENG', name: 'Engineering' })
    ).json().data.id;
    const e = await hire(a, 'E-001', {
      departmentId: dep,
      dateOfBirth: '1990-02-28',
      email: 'Nimal@x.lk',
    });
    const got = (await call(a, 'GET', `/employees/${e.id}`)).json().data;
    expect(got).toMatchObject({
      employeeNumber: 'E-001',
      dateOfBirth: '1990-02-28', // calendar dates never shift with server timezone
      email: 'nimal@x.lk',
      department: { id: dep, name: 'Engineering' },
      status: 'onboarding',
      hasAccount: false, // employees exist without login accounts
    });

    expect(
      (await call(a, 'POST', '/employees', { ...base, employeeNumber: 'e-001' })).statusCode,
    ).toBe(409);
    expect(
      (await call(a, 'POST', '/employees', { ...base, employeeNumber: 'E-2', email: 'nimal@x.lk' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(a, 'POST', '/employees', {
          ...base,
          employeeNumber: 'E-3',
          dateOfBirth: '2030-01-01',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(a, 'POST', '/employees', {
          ...base,
          employeeNumber: 'E-4',
          joiningDate: '2025-02-30',
        })
      ).statusCode,
    ).toBe(422);

    const b = await register(app(), 'emp-b@b.com', 'Emp B');
    // Same number allowed in another tenant; foreign department rejected; A's employee invisible.
    await hire(b, 'E-001');
    expect(
      (await call(b, 'POST', '/employees', { ...base, employeeNumber: 'E-9', departmentId: dep }))
        .statusCode,
    ).toBe(400);
    expect((await call(b, 'GET', `/employees/${e.id}`)).statusCode).toBe(404);
    expect((await call(b, 'GET', `/employees/${e.id}/history`)).statusCode).toBe(404);
    expect(
      (
        await call(b, 'POST', `/employees/${e.id}/status`, {
          status: 'active',
          effectiveDate: '2025-02-01',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call(b, 'GET', '/employees')).json().meta.total).toBe(1);
  });

  it('records transfers and manager changes and blocks reporting loops', async () => {
    const a = await register(app(), 'loop@a.com', 'Loop Co');
    const ceo = await hire(a, 'L-1');
    const mgr = await hire(a, 'L-2', { managerId: ceo.id });
    const dev = await hire(a, 'L-3', { managerId: mgr.id });

    const loop = await call(a, 'POST', `/employees/${ceo.id}/assignment`, {
      managerId: dev.id,
      effectiveDate: '2025-03-01',
    });
    expect(loop.statusCode).toBe(400);
    const self = await call(a, 'POST', `/employees/${ceo.id}/assignment`, {
      managerId: ceo.id,
      effectiveDate: '2025-03-01',
    });
    expect(self.statusCode).toBe(400);

    const dep = (
      await call(a, 'POST', '/organization/departments', { code: 'OPS', name: 'Ops' })
    ).json().data.id;
    const moved = await call(a, 'POST', `/employees/${dev.id}/assignment`, {
      departmentId: dep,
      managerId: ceo.id,
      effectiveDate: '2025-03-01',
      reason: 'Re-org',
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.manager.id).toBe(ceo.id);

    const history = (await call(a, 'GET', `/employees/${dev.id}/history`)).json().data;
    expect(history.map((h: { field: string }) => h.field).sort()).toEqual([
      'department',
      'joined',
      'manager',
    ]);
    expect(history.find((h: { field: string }) => h.field === 'manager')).toMatchObject({
      oldLabel: 'Nimal Perera',
      reason: 'Re-org',
    });

    // Manager with direct reports can't be archived; filters work.
    expect((await call(a, 'DELETE', `/employees/${ceo.id}`)).statusCode).toBe(409);
    expect((await call(a, 'GET', `/employees?managerId=${ceo.id}`)).json().meta.total).toBe(2);
    expect((await call(a, 'GET', `/employees?departmentId=${dep}`)).json().meta.total).toBe(1);
    expect((await call(a, 'GET', '/employees?search=L-3')).json().meta.total).toBe(1);
  });

  it('enforces status transitions and sets lifecycle dates', async () => {
    const a = await register(app(), 'status@a.com', 'Status Co');
    const e = await hire(a, 'S-1', { status: 'probation' });
    const st = (status: string, effectiveDate = '2025-07-01') =>
      call(a, 'POST', `/employees/${e.id}/status`, { status, effectiveDate });

    expect((await st('resigned')).statusCode).toBe(400); // probation -> resigned not allowed
    expect((await st('active', '2024-01-01')).statusCode).toBe(400); // before joining
    const confirmed = await st('active');
    expect(confirmed.json().data).toMatchObject({
      status: 'active',
      confirmationDate: '2025-07-01',
    });
    expect((await st('on_notice', '2025-09-01')).json().data.resignationDate).toBe('2025-09-01');
    expect((await st('resigned', '2025-10-01')).statusCode).toBe(200);
    expect((await st('active', '2025-10-02')).statusCode).toBe(400); // final state
  });

  it('serialises concurrent status changes (no double transition)', async () => {
    const a = await register(app(), 'race@a.com', 'Race Co');
    const e = await hire(a, 'R-1', { status: 'active' });
    const results = await Promise.all(
      ['resigned', 'terminated'].map((status) =>
        call(a, 'POST', `/employees/${e.id}/status`, { status, effectiveDate: '2025-05-01' }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    const history = (await call(a, 'GET', `/employees/${e.id}/history`)).json().data;
    expect(history.filter((h: { field: string }) => h.field === 'status')).toHaveLength(1);
  });

  it('enforces permissions per action', async () => {
    const admin = await register(app(), 'eperm@a.com', 'EPerm Co');
    const e = await hire(admin, 'P-1');
    const emp = await createMember(app(), admin, 'staff@a.com', 'employee');
    const dm = await createMember(app(), admin, 'dm@a.com', 'department-manager');
    const hrm = await createMember(app(), admin, 'hrm@a.com', 'hr-manager');

    expect((await call(emp, 'GET', '/employees')).statusCode).toBe(403); // no confidential data
    expect((await call(dm, 'GET', `/employees/${e.id}`)).statusCode).toBe(200);
    expect((await call(dm, 'PATCH', `/employees/${e.id}`, { phone: '1' })).statusCode).toBe(403);
    expect(
      (await call(hrm, 'PATCH', `/employees/${e.id}`, { phone: '0771234567' })).statusCode,
    ).toBe(200);
    expect((await call(hrm, 'DELETE', `/employees/${e.id}`)).statusCode).toBe(403);
    expect((await call(admin, 'DELETE', `/employees/${e.id}`)).statusCode).toBe(200);
    expect((await call(admin, 'GET', `/employees/${e.id}`)).statusCode).toBe(404);
    // Archived number can be reused
    await hire(admin, 'P-1');
  });
});
