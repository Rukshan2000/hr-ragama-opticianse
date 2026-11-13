import type { FastifyPluginAsync } from 'fastify';
import { coreHrRoutes } from './core-hr/core-hr.routes';
import { filesRoutes } from './files/files.routes';
import { notificationsRoutes } from './notifications/notifications.routes';
import { portalRoutes } from './portal/portal.routes';
import { payrollRoutes } from './payroll/payroll.routes';
import { adminRoutes } from './admin/admin.routes';
import { talentRoutes } from './talent/talent.routes';
import { timeRoutes } from './time/time.routes';
import { workflowRoutes } from './workflow/workflow.routes';

/** HR modules added in stages 2–8, each a self-contained plugin. */
export const hrRoutes: FastifyPluginAsync = async (app) => {
  await app.register(notificationsRoutes, { prefix: '/notifications' });
  await app.register(workflowRoutes);
  await app.register(filesRoutes);
  await app.register(coreHrRoutes);
  await app.register(timeRoutes);
  await app.register(payrollRoutes);
  await app.register(talentRoutes);
  await app.register(adminRoutes);
  await app.register(portalRoutes);
};
