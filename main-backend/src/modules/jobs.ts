import type { FastifyBaseLogger } from 'fastify';
import { db } from '../database/knex';
import { runHrReminders } from './core-hr/core-hr.service';
import { tenantToday } from './hr-common/me';
import { trainingService } from './talent/talent.service';
import { addDays } from './time/attendance-calc';
import { attendanceService } from './time/time.service';

/**
 * Hourly background jobs. Every job is idempotent (dedupe keys / upserts), so overlapping runs
 * across instances only repeat work, never duplicate notifications or records.
 * ponytail: in-process timer; move to a scheduler (cron / queue) when running many instances.
 */
export function startJobs(log: FastifyBaseLogger): () => void {
  const run = async () => {
    try {
      await runHrReminders();
      await trainingService.remindExpiring();
      // Mark yesterday's missing attendance as absent, per tenant time zone.
      const tenants = await db('tenants')
        .where({ is_active: true })
        .whereNull('deleted_at')
        .pluck('id');
      for (const t of tenants as string[])
        await attendanceService.markMissing(t, addDays(await tenantToday(t), -1));
    } catch (err) {
      log.error({ err }, 'Background job failed');
    }
  };
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  setTimeout(() => void run(), 30_000).unref();
  return () => clearInterval(timer);
}
