import type { RouteHandlerMethod } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { requirePermissions } from '../auth/auth.guard';
import { masterController, unitsController as units } from './organization.controller';
import * as s from './organization.schema';
import {
  branchesService,
  departmentsService,
  designationsService,
  levelsService,
} from './organization.service';

const tags = ['Organization'];
const security = [{ bearerAuth: [] }];
const read = requirePermissions(P.ORGANIZATION_READ);
const manage = requirePermissions(P.ORGANIZATION_MANAGE);
// Handlers are typed against the parsed schemas below; Fastify's generic inference can't see that.
const h = (fn: unknown) => fn as RouteHandlerMethod;

export const organizationRoutes: FastifyPluginAsyncZod = async (app) => {
  const resources: [
    string,
    string,
    ReturnType<typeof masterController>,
    z.ZodType,
    z.ZodType,
    z.ZodType,
  ][] = [
    [
      'branches',
      'Branch',
      masterController(branchesService, 'Branch'),
      s.masterListQuery,
      s.branchBody,
      s.branchPatch,
    ],
    [
      'departments',
      'Department',
      masterController(departmentsService, 'Department'),
      s.masterListQuery,
      s.departmentBody,
      s.departmentPatch,
    ],
    [
      'designations',
      'Designation',
      masterController(designationsService, 'Designation'),
      s.masterListQuery,
      s.designationBody,
      s.designationPatch,
    ],
    [
      'levels',
      'Organization level',
      masterController(levelsService, 'Level'),
      s.levelListQuery,
      s.levelBody,
      s.levelPatch,
    ],
  ];

  for (const [path, label, c, querystring, body, patch] of resources) {
    app.get(
      `/${path}`,
      { preHandler: read, schema: { tags, security, summary: `List ${path}`, querystring } },
      h(c.list),
    );
    app.get(
      `/${path}/:id`,
      { preHandler: read, schema: { tags, security, summary: `Get ${label}`, params: s.idParams } },
      h(c.get),
    );
    app.post(
      `/${path}`,
      { preHandler: manage, schema: { tags, security, summary: `Create ${label}`, body } },
      h(c.create),
    );
    app.patch(
      `/${path}/:id`,
      {
        preHandler: manage,
        schema: { tags, security, summary: `Update ${label}`, params: s.idParams, body: patch },
      },
      h(c.update),
    );
    app.delete(
      `/${path}/:id`,
      {
        preHandler: manage,
        schema: { tags, security, summary: `Delete ${label}`, params: s.idParams },
      },
      h(c.remove),
    );
  }

  app.get(
    '/units',
    { preHandler: read, schema: { tags, security, summary: 'Organization chart (all units)' } },
    units.list,
  );
  app.get(
    '/units/:id',
    { preHandler: read, schema: { tags, security, summary: 'Get unit', params: s.idParams } },
    h(units.get),
  );
  app.post(
    '/units',
    { preHandler: manage, schema: { tags, security, summary: 'Create unit', body: s.unitBody } },
    h(units.create),
  );
  app.patch(
    '/units/:id',
    {
      preHandler: manage,
      schema: {
        tags,
        security,
        summary: 'Update / move unit',
        params: s.idParams,
        body: s.unitPatch,
      },
    },
    h(units.update),
  );
  app.delete(
    '/units/:id',
    { preHandler: manage, schema: { tags, security, summary: 'Delete unit', params: s.idParams } },
    h(units.remove),
  );
};
