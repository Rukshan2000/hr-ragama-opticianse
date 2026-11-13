import { describe, expect, it } from 'vitest';
import { toCsv } from '../../src/modules/portal/reports.service';
import {
  calculatePayslip,
  progressiveTax,
  type PayrollPolicy,
} from '../../src/modules/payroll/payroll-calc';
import { accrued } from '../../src/modules/time/leave.service';
import {
  computeAttendance,
  DEFAULT_POLICY,
  rotationWeek,
  shiftWindow,
  zonedDate,
  zonedInstant,
} from '../../src/modules/time/attendance-calc';
import { renderPdf } from '../../src/shared/utils/pdf';
import { detectFileType } from '../../src/shared/utils/storage';

const day = {
  start_time: '09:00',
  end_time: '17:00',
  break_minutes: 60,
  grace_minutes: 10,
  early_leave_grace_minutes: 5,
};
const night = {
  start_time: '22:00',
  end_time: '06:00',
  break_minutes: 30,
  grace_minutes: 5,
  early_leave_grace_minutes: 0,
};
const ctx = (shift: typeof day | null, extra = {}) => ({
  workDate: '2026-03-02',
  tz: 'Asia/Colombo',
  shift,
  isHoliday: false,
  onLeave: false,
  policy: DEFAULT_POLICY,
  ...extra,
});
const at = (iso: string) => new Date(iso);

describe('time zones', () => {
  it('converts wall-clock times in the tenant zone, not the server zone', () => {
    expect(zonedInstant('2026-03-02', '09:00', 'Asia/Colombo').toISOString()).toBe(
      '2026-03-02T03:30:00.000Z',
    );
    expect(zonedInstant('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    ); // BST
    expect(zonedInstant('2026-01-15', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    ); // GMT
    expect(zonedDate(at('2026-03-02T20:00:00Z'), 'Asia/Colombo')).toBe('2026-03-03');
  });

  it('places an overnight shift end on the next day', () => {
    const w = shiftWindow('2026-03-02', night, 'Asia/Colombo');
    expect(w.overnight).toBe(true);
    expect(w.start.toISOString()).toBe('2026-03-02T16:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-03T00:30:00.000Z');
  });
});

describe('attendance calculation', () => {
  it('computes worked time, lateness beyond grace and early departure', () => {
    // 09:25 → 16:30 Colombo (03:55Z → 11:00Z)
    const r = computeAttendance(ctx(day), at('2026-03-02T03:55:00Z'), at('2026-03-02T11:00:00Z'));
    expect(r).toMatchObject({
      worked_minutes: 365,
      late_minutes: 25,
      early_leave_minutes: 30,
      overtime_minutes: 0,
      status: 'late',
    });
  });

  it('within grace is on time; overtime needs the threshold', () => {
    const ok = computeAttendance(ctx(day), at('2026-03-02T03:38:00Z'), at('2026-03-02T11:50:00Z'));
    expect(ok).toMatchObject({ late_minutes: 0, status: 'present', overtime_minutes: 0 }); // 22 min extra < 30
    const ot = computeAttendance(ctx(day), at('2026-03-02T03:30:00Z'), at('2026-03-02T12:30:00Z'));
    expect(ot.overtime_minutes).toBe(60);
  });

  it('handles an overnight shift across midnight', () => {
    const r = computeAttendance(ctx(night), at('2026-03-02T16:30:00Z'), at('2026-03-03T00:30:00Z'));
    expect(r).toMatchObject({
      worked_minutes: 450,
      late_minutes: 0,
      early_leave_minutes: 0,
      status: 'present',
    });
  });

  it('marks missing, half-day, leave, holiday and off days', () => {
    expect(computeAttendance(ctx(day), null, null).status).toBe('absent');
    expect(computeAttendance(ctx(day, { onLeave: true }), null, null).status).toBe('on_leave');
    expect(computeAttendance(ctx(day, { isHoliday: true }), null, null).status).toBe('holiday');
    expect(computeAttendance(ctx(null), null, null).status).toBe('off');
    const half = computeAttendance(
      ctx(day),
      at('2026-03-02T03:30:00Z'),
      at('2026-03-02T06:30:00Z'),
    );
    expect(half.status).toBe('half_day');
    const weekend = computeAttendance(
      ctx(null),
      at('2026-03-02T03:30:00Z'),
      at('2026-03-02T08:30:00Z'),
    );
    expect(weekend).toMatchObject({ status: 'present', overtime_minutes: 300 }); // no shift = no break deducted
  });

  it('rotates schedules from the assignment anchor', () => {
    expect(rotationWeek('2026-03-02', '2026-03-08', 2)).toBe(0);
    expect(rotationWeek('2026-03-02', '2026-03-09', 2)).toBe(1);
    expect(rotationWeek('2026-03-02', '2026-03-16', 2)).toBe(0);
  });
});

describe('payroll calculation', () => {
  const policy: PayrollPolicy = {
    epf_employee_rate: 8,
    epf_employer_rate: 12,
    etf_rate: 3,
    overtime_multiplier: 1.5,
    working_days_per_month: 30,
    working_hours_per_day: 8,
    apit_brackets: [
      { upTo: 150000, rate: 0 },
      { upTo: 233333, rate: 6 },
      { upTo: null, rate: 12 },
    ],
  };

  it('applies progressive brackets', () => {
    expect(progressiveTax(100000, policy.apit_brackets)).toBe(0);
    expect(progressiveTax(200000, policy.apit_brackets)).toBe(3000);
    expect(progressiveTax(300000, policy.apit_brackets)).toBeCloseTo(4999.98 + 8000.04, 1);
  });

  it('computes EPF/ETF on EPF-able pay, APIT on taxable pay, OT and unpaid days', () => {
    const r = calculatePayslip(policy, {
      basic: 240000,
      lines: [
        { label: 'Transport', kind: 'earning', amount: 10000, taxable: true, epf: false },
        { label: 'Welfare', kind: 'deduction', amount: 500, taxable: false, epf: false },
      ],
      overtimeMinutes: 120,
      unpaidDays: 1,
      loanDeduction: 5000,
      proration: 1,
    });
    // daily 8000, hourly 1000, OT 2h × 1.5 = 3000
    expect(r.unpaid_leave_deduction).toBe(8000);
    expect(r.overtime_pay).toBe(3000);
    expect(r.gross_pay).toBe(245000);
    expect(r.epf_employee).toBe(18560); // 8% of 232000
    expect(r.epf_employer).toBe(27840);
    expect(r.etf).toBe(6960);
    expect(r.apit).toBe(progressiveTax(245000, policy.apit_brackets));
    expect(r.net_pay).toBeCloseTo(245000 - 500 - 18560 - r.apit - 5000, 2);
  });

  it('prorates a mid-month joiner', () => {
    const r = calculatePayslip(policy, {
      basic: 90000,
      lines: [],
      overtimeMinutes: 0,
      unpaidDays: 0,
      loanDeduction: 0,
      proration: 0.5,
    });
    expect(r.basic_salary).toBe(45000);
  });
});

describe('leave accrual', () => {
  it('accrues monthly entitlement by completed month, rounded down to half days', () => {
    expect(accrued(14, 'annual', 2026, '2026-02-01')).toBe(14);
    expect(accrued(14, 'monthly', 2026, '2026-03-15')).toBe(3.5);
    expect(accrued(14, 'monthly', 2025, '2026-01-01')).toBe(14);
  });
});

describe('file and export safety', () => {
  it('accepts files only when extension and content agree', () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    expect(detectFileType('cv.pdf', pdf)).toBe('application/pdf');
    expect(detectFileType('cv.png', pdf)).toBeNull();
    expect(detectFileType('evil.exe', pdf)).toBeNull();
    expect(detectFileType('notes.txt', Buffer.from([0x41, 0x00, 0x42]))).toBeNull();
  });

  it('neutralises spreadsheet formulas in CSV', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }], [{ a: '=HYPERLINK("x")' }, { a: '-42' }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('\r\n-42');
  });

  it('renders a valid PDF', () => {
    const pdf = renderPdf([
      { text: 'Payslip', bold: true },
      { text: 'Net', right: 'LKR 1,000.00' },
    ]).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
