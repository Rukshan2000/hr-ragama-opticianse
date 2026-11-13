/** Pure attendance math. All instants are Date (UTC); calendar values are interpreted in `tz`. */

export interface ShiftSpec {
  start_time: string; // 'HH:MM[:SS]'
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  early_leave_grace_minutes: number;
}
export interface PolicySpec {
  overtime_threshold_minutes: number;
  half_day_minutes: number;
  count_weekend_as_overtime: boolean;
}
export const DEFAULT_POLICY: PolicySpec = {
  overtime_threshold_minutes: 30,
  half_day_minutes: 240,
  count_weekend_as_overtime: true,
};

/** Offset (ms) of `tz` from UTC at instant `at`. */
function tzOffset(at: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant of wall-clock `date time` in `tz` (DST-safe for non-gap times). */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss = 0] = time.split(':').map(Number) as [number, number, number?];
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz); // second pass corrects across DST transitions
  return new Date(t);
}

/** Calendar date (YYYY-MM-DD) of an instant in `tz`. */
export const zonedDate = (at: Date, tz: string) => at.toLocaleDateString('en-CA', { timeZone: tz });

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string) =>
  ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Scheduled window; an end at or before the start means the shift ends the next day. */
export function shiftWindow(workDate: string, shift: ShiftSpec, tz: string) {
  const overnight = shift.end_time <= shift.start_time;
  return {
    start: zonedInstant(workDate, shift.start_time, tz),
    end: zonedInstant(overnight ? addDays(workDate, 1) : workDate, shift.end_time, tz),
    overnight,
  };
}

export interface DayContext {
  workDate: string;
  tz: string;
  shift: ShiftSpec | null; // null = scheduled day off
  isHoliday: boolean;
  onLeave: boolean;
  policy: PolicySpec;
}

export interface AttendanceResult {
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  break_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  status: 'present' | 'late' | 'half_day' | 'absent' | 'on_leave' | 'holiday' | 'off';
}

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));

export function computeAttendance(
  ctx: DayContext,
  checkIn: Date | null,
  checkOut: Date | null,
  breakOverride?: number | null,
): AttendanceResult {
  const window = ctx.shift ? shiftWindow(ctx.workDate, ctx.shift, ctx.tz) : null;
  const working = Boolean(window) && !ctx.isHoliday && !ctx.onLeave;
  const base = {
    scheduled_start: window?.start ?? null,
    scheduled_end: window?.end ?? null,
    break_minutes: 0,
    worked_minutes: 0,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
  };
  if (!checkIn) {
    const status = ctx.onLeave
      ? 'on_leave'
      : ctx.isHoliday
        ? 'holiday'
        : !window
          ? 'off'
          : 'absent';
    return { ...base, status };
  }

  const span = checkOut ? minutes(checkOut.getTime() - checkIn.getTime()) : 0;
  const plannedBreak = breakOverride ?? ctx.shift?.break_minutes ?? 0;
  // Breaks are only deducted from a span long enough to contain them.
  const brk = span > plannedBreak ? plannedBreak : 0;
  const worked = span - brk;

  if (!working) {
    // Work on a day off / holiday / leave day: everything worked can be overtime.
    const ot =
      ctx.policy.count_weekend_as_overtime && worked >= ctx.policy.overtime_threshold_minutes
        ? worked
        : 0;
    return {
      ...base,
      break_minutes: brk,
      worked_minutes: worked,
      overtime_minutes: ot,
      status: 'present',
    };
  }

  const w = window!;
  const s = ctx.shift!;
  const lateBy = minutes(checkIn.getTime() - w.start.getTime());
  const late = lateBy > s.grace_minutes ? lateBy : 0;
  const earlyBy = checkOut ? minutes(w.end.getTime() - checkOut.getTime()) : 0;
  const early = earlyBy > s.early_leave_grace_minutes ? earlyBy : 0;
  const scheduled = minutes(w.end.getTime() - w.start.getTime()) - s.break_minutes;
  const extra = worked - scheduled;
  const overtime = checkOut && extra >= ctx.policy.overtime_threshold_minutes ? extra : 0;
  const status =
    checkOut && worked < ctx.policy.half_day_minutes ? 'half_day' : late ? 'late' : 'present';
  return {
    ...base,
    break_minutes: brk,
    worked_minutes: worked,
    late_minutes: late,
    early_leave_minutes: early,
    overtime_minutes: overtime,
    status,
  };
}

/** Week of a rotation for `date`, anchored at the assignment's start date. */
export function rotationWeek(anchor: string, date: string, rotationWeeks: number) {
  const weeks = Math.floor(daysBetween(anchor, date) / 7);
  return ((weeks % rotationWeeks) + rotationWeeks) % rotationWeeks;
}
