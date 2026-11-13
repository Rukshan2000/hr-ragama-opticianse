/** Pure payroll math. Every statutory rate comes from the effective payroll policy. */

export interface PayrollPolicy {
  epf_employee_rate: number;
  epf_employer_rate: number;
  etf_rate: number;
  overtime_multiplier: number;
  working_days_per_month: number;
  working_hours_per_day: number;
  /** Monthly progressive brackets; `upTo: null` is the open top bracket. */
  apit_brackets: { upTo: number | null; rate: number }[];
}

export interface PayLine {
  label: string;
  kind: 'earning' | 'deduction';
  amount: number;
  taxable: boolean;
  epf: boolean;
}

export interface PayInput {
  basic: number;
  lines: PayLine[];
  overtimeMinutes: number;
  unpaidDays: number;
  loanDeduction: number;
  /** Fraction of the month employed (joined/left mid-month); 1 = full month. */
  proration: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Progressive tax over monthly taxable income. */
export function progressiveTax(taxable: number, brackets: PayrollPolicy['apit_brackets']): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * (b.rate / 100);
    if (taxable <= upper) break;
    lower = upper;
  }
  return r2(Math.max(0, tax));
}

export function calculatePayslip(p: PayrollPolicy, i: PayInput) {
  const basic = r2(i.basic * i.proration);
  const daily = i.basic / p.working_days_per_month;
  const hourly = daily / p.working_hours_per_day;
  const unpaid = r2(Math.min(basic, daily * i.unpaidDays));
  const otHours = r2(i.overtimeMinutes / 60);
  const otPay = r2(hourly * p.overtime_multiplier * otHours);

  const earnings = i.lines
    .filter((l) => l.kind === 'earning')
    .map((l) => ({ ...l, amount: r2(l.amount) }));
  if (otPay > 0)
    earnings.push({
      label: `Overtime (${otHours} h)`,
      kind: 'earning',
      amount: otPay,
      taxable: true,
      epf: false,
    });
  const sum = (ls: PayLine[], f: (l: PayLine) => boolean = () => true) =>
    ls.filter(f).reduce((s, l) => s + l.amount, 0);

  const gross = r2(basic - unpaid + sum(earnings));
  const epfBase = r2(basic - unpaid + sum(earnings, (l) => l.epf));
  const taxable = r2(basic - unpaid + sum(earnings, (l) => l.taxable));
  const epfEmployee = r2((epfBase * p.epf_employee_rate) / 100);
  const epfEmployer = r2((epfBase * p.epf_employer_rate) / 100);
  const etf = r2((epfBase * p.etf_rate) / 100);
  const apit = progressiveTax(taxable, p.apit_brackets);

  const deductions: { label: string; amount: number }[] = [
    ...i.lines
      .filter((l) => l.kind === 'deduction')
      .map((l) => ({ label: l.label, amount: r2(l.amount) })),
  ];
  if (epfEmployee)
    deductions.push({ label: `EPF employee (${p.epf_employee_rate}%)`, amount: epfEmployee });
  if (apit) deductions.push({ label: 'APIT', amount: apit });
  if (i.loanDeduction)
    deductions.push({ label: 'Loan / advance recovery', amount: r2(i.loanDeduction) });
  const totalDeductions = r2(deductions.reduce((s, d) => s + d.amount, 0));

  return {
    basic_salary: basic,
    earnings: earnings.map((l) => ({ label: l.label, amount: l.amount })),
    deductions,
    overtime_hours: otHours,
    overtime_pay: otPay,
    unpaid_days: i.unpaidDays,
    unpaid_leave_deduction: unpaid,
    gross_pay: gross,
    epf_employee: epfEmployee,
    epf_employer: epfEmployer,
    etf,
    apit,
    loan_deduction: r2(i.loanDeduction),
    total_deductions: totalDeductions,
    net_pay: r2(gross - totalDeductions),
  };
}
