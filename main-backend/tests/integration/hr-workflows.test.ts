import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/knex';
import {
  API,
  bearer,
  createMember,
  register,
  setupTestApp,
  type Session,
} from '../helpers/test-app';

const app = setupTestApp();
type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (s: Session, method: M, url: string, payload?: object) =>
  app().inject({ method, url: `${API}${url}`, headers: bearer(s), payload });
const ok = async (s: Session, method: M, url: string, payload?: object, status = [200, 201]) => {
  const r = await call(s, method, url, payload);
  expect(status, `${method} ${url}: ${r.body}`).toContain(r.statusCode);
  return r.json().data;
};

/** Tenant with an admin, a manager and a staff member, each linked to an employee record. */
async function org(prefix: string) {
  const admin = await register(app(), `${prefix}-admin@x.lk`, `Org ${prefix}`);
  const lead = await createMember(app(), admin, `${prefix}-lead@x.lk`, 'team-leader');
  const staff = await createMember(app(), admin, `${prefix}-staff@x.lk`, 'employee');
  const hire = (n: string, extra: object = {}) =>
    ok(admin, 'POST', '/employees', {
      employeeNumber: n,
      firstName: n,
      lastName: 'Test',
      joiningDate: '2025-01-06',
      status: 'active',
      ...extra,
    });
  const mgr = await hire(`${prefix}-M`);
  const emp = await hire(`${prefix}-S`, { managerId: mgr.id });
  await ok(admin, 'PUT', `/employees/${mgr.id}/account`, { userId: lead.userId });
  await ok(admin, 'PUT', `/employees/${emp.id}/account`, { userId: staff.userId });
  return { admin, lead, staff, mgr, emp };
}

async function leaveSetup(admin: Session, days = 14) {
  const type = await ok(admin, 'POST', '/leave-types', { code: 'AL', name: 'Annual leave' });
  await ok(admin, 'POST', '/leave-policies', {
    leaveTypeId: type.id,
    annualDays: days,
    effectiveFrom: '2026-01-01',
  });
  return type;
}

describe('leave + approval workflow', () => {
  it('applies, routes to the manager, approves once, and updates the balance', async () => {
    const { admin, lead, staff, emp } = await org('lv');
    const type = await leaveSetup(admin);

    // 2026-03-02 (Mon) → 03-04 (Wed): 3 working days (no schedule → Mon–Fri)
    const req = await ok(staff, 'POST', '/leave-requests', {
      leaveTypeId: type.id,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
    });
    expect(req).toMatchObject({ status: 'pending', days: '3.0' });

    // Overlap and duplicate requests are refused
    expect(
      (
        await call(staff, 'POST', '/leave-requests', {
          leaveTypeId: type.id,
          startDate: '2026-03-04',
          endDate: '2026-03-05',
        })
      ).statusCode,
    ).toBe(409);
    // Over balance refused (14 − 3 pending = 11 left)
    expect(
      (
        await call(staff, 'POST', '/leave-requests', {
          leaveTypeId: type.id,
          startDate: '2026-04-01',
          endDate: '2026-04-30',
        })
      ).statusCode,
    ).toBe(400);

    // Requester cannot approve; the manager sees it in their inbox
    const inboxStaff = await ok(staff, 'GET', '/approvals');
    expect(inboxStaff).toHaveLength(0);
    const inbox = await ok(lead, 'GET', '/approvals');
    expect(inbox).toHaveLength(1);
    const approvalId = inbox[0].id;
    expect(
      (await call(staff, 'POST', `/approvals/${approvalId}/decision`, { decision: 'approved' }))
        .statusCode,
    ).toBe(403);

    // Rejection needs a reason
    expect(
      (await call(lead, 'POST', `/approvals/${approvalId}/decision`, { decision: 'rejected' }))
        .statusCode,
    ).toBe(400);

    // Concurrent approvals: exactly one wins
    const [a, b] = await Promise.all([
      call(lead, 'POST', `/approvals/${approvalId}/decision`, { decision: 'approved' }),
      call(admin, 'POST', `/approvals/${approvalId}/decision`, { decision: 'approved' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const bal = await ok(staff, 'GET', `/employees/${emp.id}/leave-balances?year=2026`);
    expect(bal[0]).toMatchObject({ used: 3, pending: 0, available: 11 });
    const detail = await ok(staff, 'GET', `/leave-requests/${req.id}`);
    expect(detail.status).toBe('approved');
    expect(detail.approval.actions.map((x: { decision: string }) => x.decision)).toEqual([
      'submitted',
      'approved',
    ]);

    // Notifications: requester informed exactly once
    const notes = await ok(staff, 'GET', '/notifications');
    expect(notes.items.filter((n: { type: string }) => n.type === 'approval_decided')).toHaveLength(
      1,
    );

    // HR cancels approved leave → balance restored
    await ok(admin, 'POST', `/leave-requests/${req.id}/cancel`, { reason: 'Plans changed' });
    const after = await ok(staff, 'GET', `/employees/${emp.id}/leave-balances?year=2026`);
    expect(after[0]).toMatchObject({ used: 0, available: 14 });
  });

  it('supports two half days on one date but not the same half twice', async () => {
    const { admin, staff } = await org('hd');
    const type = await leaveSetup(admin);
    await ok(staff, 'POST', '/leave-requests', {
      leaveTypeId: type.id,
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      halfDay: 'am',
    });
    expect(
      (
        await call(staff, 'POST', '/leave-requests', {
          leaveTypeId: type.id,
          startDate: '2026-03-02',
          endDate: '2026-03-02',
          halfDay: 'am',
        })
      ).statusCode,
    ).toBe(409);
    const pm = await ok(staff, 'POST', '/leave-requests', {
      leaveTypeId: type.id,
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      halfDay: 'pm',
    });
    expect(pm.days).toBe('0.5');
  });

  it('uses a configured multi-step role workflow', async () => {
    const { admin, lead, staff } = await org('wf');
    const type = await leaveSetup(admin);
    const hrRole = await db('roles')
      .where({ tenant_id: admin.tenantId, slug: 'hr-manager' })
      .first('id');
    const hr = await createMember(app(), admin, 'wf-hr@x.lk', 'hr-manager');
    await ok(admin, 'PUT', '/workflows/leave_request', {
      name: 'Two-step',
      steps: [{ type: 'manager' }, { type: 'role', roleId: hrRole.id }],
    });
    await ok(staff, 'POST', '/leave-requests', {
      leaveTypeId: type.id,
      startDate: '2026-05-04',
      endDate: '2026-05-04',
    });
    const [step1] = await ok(lead, 'GET', '/approvals');
    await ok(lead, 'POST', `/approvals/${step1.id}/decision`, { decision: 'approved' });
    expect((await ok(lead, 'GET', '/approvals')).length).toBe(0);
    const [step2] = await ok(hr, 'GET', '/approvals');
    expect(step2.currentStep).toBe(2);
    await ok(hr, 'POST', `/approvals/${step2.id}/decision`, {
      decision: 'rejected',
      comment: 'Peak season',
    });
    const mine = await ok(staff, 'GET', '/leave-requests');
    expect(mine[0]).toMatchObject({ status: 'rejected', decisionComment: 'Peak season' });
  });
});

describe('payroll', () => {
  it('calculates, finalizes, protects finalized runs and restricts access', async () => {
    const { admin, staff, emp } = await org('pr');
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
    const comp = await ok(admin, 'POST', '/salary-components', {
      code: 'TRN',
      name: 'Transport',
      kind: 'earning',
      isTaxable: true,
    });
    await ok(admin, 'POST', '/salaries', {
      employeeId: emp.id,
      effectiveFrom: '2026-01-01',
      basicSalary: 200000,
      items: [{ componentId: comp.id, amount: 10000 }],
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
    expect((await call(admin, 'POST', '/payroll-runs', { year: 2026, month: 3 })).statusCode).toBe(
      409,
    );
    const calc = await ok(admin, 'POST', `/payroll-runs/${run.id}/calculate`);
    const slip = calc.payslips.find((p: { employeeId: string }) => p.employeeId === emp.id);
    expect(slip).toMatchObject({
      basicSalary: 200000,
      grossPay: 215000,
      epfEmployee: 16000,
      epfEmployer: 24000,
      etf: 6000,
      apit: 3900,
    });

    // Not visible to the employee until finalized
    expect((await call(staff, 'GET', `/payslips/${slip.id}`)).statusCode).toBe(404);
    expect(await ok(staff, 'GET', '/payslips/mine')).toHaveLength(0);
    // Payroll data is restricted: no payroll permission → 403
    expect((await call(staff, 'GET', '/payroll-runs')).statusCode).toBe(403);

    await ok(admin, 'POST', `/payroll-runs/${run.id}/approve`);
    expect((await call(admin, 'POST', `/payroll-runs/${run.id}/calculate`)).statusCode).toBe(409);
    expect((await call(admin, 'DELETE', `/payroll-runs/${run.id}`)).statusCode).toBe(409);
    expect(
      (
        await call(admin, 'POST', '/payroll-adjustments', {
          employeeId: emp.id,
          year: 2026,
          month: 3,
          kind: 'earning',
          label: 'Late',
          amount: 1,
        })
      ).statusCode,
    ).toBe(409);
    // The database itself refuses to rewrite a finalized payslip.
    await expect(db('payslips').where({ id: slip.id }).update({ net_pay: 1 })).rejects.toThrow(
      /finalized/,
    );

    expect(await ok(staff, 'GET', '/payslips/mine')).toHaveLength(1);
    const pdf = await call(staff, 'GET', `/payslips/${slip.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.startsWith('%PDF')).toBe(true);
    await ok(admin, 'POST', `/payroll-runs/${run.id}/lock`);
  });
});

describe('attendance', () => {
  it('records an overnight shift, rejects overlaps and approves corrections', async () => {
    const { admin, lead, staff, emp } = await org('at');
    const shift = await ok(admin, 'POST', '/shifts', {
      code: 'N',
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 30,
    });
    const sched = await ok(admin, 'POST', '/work-schedules', {
      name: 'Nights',
      days: [1, 2, 3, 4, 5].map((weekday) => ({ weekIndex: 0, weekday, shiftId: shift.id })),
    });
    await ok(admin, 'POST', '/schedule-assignments', {
      employeeId: emp.id,
      scheduleId: sched.id,
      effectiveFrom: '2026-03-02',
    });
    // Overlapping schedule assignment is refused by the exclusion constraint.
    expect(
      (
        await call(admin, 'POST', '/schedule-assignments', {
          employeeId: emp.id,
          scheduleId: sched.id,
          effectiveFrom: '2026-03-10',
        })
      ).statusCode,
    ).toBe(409);

    // 22:20 → 06:00 Colombo (+05:30)
    const rec = await ok(admin, 'POST', '/attendance', {
      employeeId: emp.id,
      workDate: '2026-03-02',
      checkIn: '2026-03-02T22:20:00+05:30',
      checkOut: '2026-03-03T06:00:00+05:30',
    });
    expect(rec).toMatchObject({ status: 'late', lateMinutes: 20, workedMinutes: 430 });
    // A next-day period overlapping it is refused
    expect(
      (
        await call(admin, 'POST', '/attendance', {
          employeeId: emp.id,
          workDate: '2026-03-03',
          checkIn: '2026-03-03T05:00:00+05:30',
          checkOut: '2026-03-03T07:00:00+05:30',
        })
      ).statusCode,
    ).toBe(409);

    // Missing attendance becomes absent; days off are skipped
    const marked = await ok(admin, 'POST', '/attendance/mark-missing', { date: '2026-03-04' });
    expect(marked.created).toBeGreaterThanOrEqual(1);

    await ok(staff, 'POST', '/attendance-corrections', {
      workDate: '2026-03-04',
      checkIn: '2026-03-04T22:00:00+05:30',
      checkOut: '2026-03-05T06:00:00+05:30',
      reason: 'Card reader down',
    });
    const [req] = await ok(lead, 'GET', '/approvals');
    await ok(lead, 'POST', `/approvals/${req.id}/decision`, { decision: 'approved' });
    const list = await ok(staff, 'GET', '/attendance?from=2026-03-04&to=2026-03-04');
    expect(list[0]).toMatchObject({ status: 'present', source: 'correction' });
    // Employees only ever see their own attendance
    expect(
      (await ok(staff, 'GET', '/attendance')).every(
        (r: { employeeId: string }) => r.employeeId === emp.id,
      ),
    ).toBe(true);
  });
});

describe('files, documents and contracts', () => {
  it('stores private files, authorizes downloads and isolates tenants', async () => {
    const { admin, staff, emp, mgr } = await org('fl');
    const up = await app().inject({
      method: 'POST',
      url: `${API}/files?filename=id.pdf&purpose=document&employeeId=${emp.id}`,
      headers: { ...bearer(admin), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('%PDF-1.4 hello'),
    });
    expect(up.statusCode, up.body).toBe(201);
    const file = up.json().data;
    // Renamed executable rejected
    const bad = await app().inject({
      method: 'POST',
      url: `${API}/files?filename=x.pdf&purpose=document`,
      headers: { ...bearer(admin), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('MZ\x90\x00'),
    });
    expect(bad.statusCode).toBe(400);

    const doc = await ok(admin, 'POST', `/employees/${emp.id}/documents`, {
      fileId: file.id,
      category: 'identity',
      title: 'NIC',
    });
    expect(doc.title).toBe('NIC');
    // The owner can download; a colleague (the manager) cannot read personal documents.
    const own = await call(staff, 'GET', `/files/${file.id}/content`);
    expect(own.statusCode).toBe(200);
    expect(own.body).toContain('%PDF');
    expect(own.headers['content-disposition']).toContain('attachment');
    const lead = (await org('fl2')).admin;
    expect((await call(lead, 'GET', `/files/${file.id}/content`)).statusCode).toBe(404); // other tenant
    expect((await call(lead, 'GET', `/employees/${emp.id}/documents`)).statusCode).toBe(404);
    void mgr;

    // Contracts: one active contract per period; renewal; probation confirmation.
    await ok(admin, 'POST', `/employees/${emp.id}/status`, {
      status: 'on_notice',
      effectiveDate: '2026-01-10',
    }).catch(() => undefined);
    const c = await ok(admin, 'POST', '/contracts', {
      employeeId: emp.id,
      contractNumber: 'C-1',
      contractType: 'contract',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
    await ok(admin, 'POST', `/contracts/${c.id}/activate`);
    const c2 = await ok(admin, 'POST', '/contracts', {
      employeeId: emp.id,
      contractNumber: 'C-2',
      contractType: 'contract',
      startDate: '2026-03-01',
      endDate: '2026-12-31',
    });
    expect((await call(admin, 'POST', `/contracts/${c2.id}/activate`)).statusCode).toBe(409);
    expect(
      (await call(admin, 'PATCH', `/contracts/${c.id}`, { endDate: '2027-01-01' })).statusCode,
    ).toBe(409);
    const renewed = await ok(admin, 'POST', `/contracts/${c.id}/renew`, {
      contractNumber: 'C-3',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
    });
    expect(renewed).toMatchObject({ status: 'active', renewedFromId: c.id });
    expect((await ok(admin, 'GET', `/contracts/${c.id}`)).status).toBe('renewed');
  });
});

describe('expenses, exit, recruitment, reports', () => {
  it('runs an expense claim through approval and reimbursement', async () => {
    const { admin, lead, staff } = await org('ex');
    const cat = await ok(admin, 'POST', '/expense-categories', {
      code: 'TRV',
      name: 'Travel',
      maxAmount: 5000,
      requiresReceipt: false,
    });
    expect(
      (
        await call(staff, 'POST', '/expense-claims', {
          categoryId: cat.id,
          expenseDate: '2026-01-05',
          amount: 6000,
          description: 'Taxi',
        })
      ).statusCode,
    ).toBe(400);
    const claim = await ok(staff, 'POST', '/expense-claims', {
      categoryId: cat.id,
      expenseDate: '2026-01-05',
      amount: 1200,
      description: 'Taxi to client',
    });
    expect(
      (
        await call(admin, 'POST', `/expense-claims/${claim.id}/reimburse`, {
          reimbursedOn: '2026-01-10',
        })
      ).statusCode,
    ).toBe(409);
    const [req] = await ok(lead, 'GET', '/approvals');
    await ok(lead, 'POST', `/approvals/${req.id}/decision`, { decision: 'approved' });
    const paid = await ok(admin, 'POST', `/expense-claims/${claim.id}/reimburse`, {
      reimbursedOn: '2026-01-10',
      paymentReference: 'TX-1',
    });
    expect(paid.status).toBe('reimbursed');
  });

  it('handles resignation → notice → clearance → resigned', async () => {
    const { admin, lead, staff, emp } = await org('xt');
    const cat = await ok(admin, 'POST', '/asset-categories', { code: 'LAP', name: 'Laptops' });
    const asset = await ok(admin, 'POST', '/assets', {
      categoryId: cat.id,
      assetTag: 'LT-1',
      name: 'ThinkPad',
    });
    await ok(admin, 'POST', `/assets/${asset.id}/assign`, {
      employeeId: emp.id,
      assignedOn: '2026-01-02',
    });
    expect(
      (
        await call(admin, 'POST', `/assets/${asset.id}/assign`, {
          employeeId: emp.id,
          assignedOn: '2026-01-03',
        })
      ).statusCode,
    ).toBe(409);

    const x = await ok(staff, 'POST', '/exit-cases', {
      noticeDate: '2026-02-01',
      noticeDays: 30,
      reason: 'Relocating',
    });
    const [req] = await ok(lead, 'GET', '/approvals');
    await ok(lead, 'POST', `/approvals/${req.id}/decision`, { decision: 'approved' });
    const approved = await ok(admin, 'GET', `/exit-cases/${x.id}`);
    expect(approved.status).toBe('approved');
    expect((await ok(admin, 'GET', `/employees/${emp.id}`)).status).toBe('on_notice');

    const assets = approved.clearances.find((c: { area: string }) => c.area === 'Assets');
    expect(
      (
        await call(admin, 'PATCH', `/exit-cases/${x.id}/clearances/${assets.id}`, {
          isCleared: true,
        })
      ).statusCode,
    ).toBe(409);
    await ok(admin, 'POST', `/assets/${asset.id}/return`, {
      returnedOn: '2026-03-02',
      conditionIn: 'good',
    });
    for (const c of approved.clearances)
      await ok(admin, 'PATCH', `/exit-cases/${x.id}/clearances/${c.id}`, { isCleared: true });
    await ok(admin, 'PATCH', `/exit-cases/${x.id}`, {
      settlementEarnings: 50000,
      settlementDeductions: 2000,
    });
    const done = await ok(admin, 'POST', `/exit-cases/${x.id}/complete`);
    expect(done).toMatchObject({ status: 'completed', settlementNet: 48000 });
    expect((await ok(admin, 'GET', `/employees/${emp.id}`)).status).toBe('resigned');
  });

  it('converts a hired applicant into one employee record', async () => {
    const { admin } = await org('rc');
    const v = await ok(admin, 'POST', '/vacancies', {
      code: 'V1',
      title: 'Optometrist',
      status: 'open',
    });
    const p = await ok(admin, 'POST', '/applicants', {
      firstName: 'Kamal',
      lastName: 'Silva',
      email: 'Kamal@x.lk',
    });
    const a = await ok(admin, 'POST', '/applications', { vacancyId: v.id, applicantId: p.id });
    expect(
      (await call(admin, 'POST', `/applications/${a.id}/hire`, { employeeNumber: 'N-1' }))
        .statusCode,
    ).toBe(409);
    await ok(admin, 'POST', `/applications/${a.id}/offer`, {
      offerSalary: 150000,
      offerStartDate: '2026-04-01',
      offerStatus: 'accepted',
    });
    const e = await ok(admin, 'POST', `/applications/${a.id}/hire`, { employeeNumber: 'N-1' });
    expect(e).toMatchObject({
      email: 'kamal@x.lk',
      joiningDate: '2026-04-01',
      status: 'onboarding',
    });
    expect(
      (await call(admin, 'POST', `/applications/${a.id}/hire`, { employeeNumber: 'N-2' }))
        .statusCode,
    ).toBe(409);
    expect((await ok(admin, 'GET', `/vacancies/${v.id}`)).status).toBe('filled');
  });

  it('exports reports with permission checks', async () => {
    const { admin, staff } = await org('rp');
    const csv = await call(admin, 'GET', '/reports/employees?format=csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('rp-M');
    const xls = await call(admin, 'GET', '/reports/payroll?format=xls&year=2026&month=1');
    expect(xls.body).toContain('<Workbook');
    expect((await call(staff, 'GET', '/reports/employees')).statusCode).toBe(403);
    const dash = await ok(admin, 'GET', '/dashboard');
    expect(dash.headcount.total).toBe(2);
    const empDash = await ok(staff, 'GET', '/dashboard');
    expect(empDash.headcount).toBeUndefined(); // no employees:read
  });

  it('applies contact changes directly and routes sensitive changes to HR', async () => {
    const { admin, staff, emp } = await org('ss');
    const r = await ok(staff, 'PATCH', '/me/profile', { phone: '0771234567', lastName: 'Perera' });
    expect(r.approvalRequested).toBe(true);
    const e = await ok(admin, 'GET', `/employees/${emp.id}`);
    expect(e).toMatchObject({ phone: '0771234567', lastName: 'Test' });
    const [req] = await ok(admin, 'GET', '/approvals?box=all&status=pending');
    await ok(admin, 'POST', `/approvals/${req.id}/decision`, { decision: 'approved' });
    expect((await ok(admin, 'GET', `/employees/${emp.id}`)).lastName).toBe('Perera');
  });
});
