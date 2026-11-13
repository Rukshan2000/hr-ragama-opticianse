import type { Knex } from 'knex';
import { sqlList as list, tenantRef, tenantTable } from '../migration-helpers';

export const CONTRACT_TYPES = ['permanent', 'temporary', 'contract', 'internship'] as const;
export const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated', 'renewed'] as const;
export const DOCUMENT_CATEGORIES = [
  'identity',
  'education',
  'certificate',
  'contract',
  'medical',
  'other',
] as const;
export const APPROVER_TYPES = ['manager', 'role', 'user'] as const;
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/**
 * Stage 2 (documents, contracts, onboarding/exit tasks) and Stage 4 infrastructure
 * (audit log, generic approval workflow, notifications, tenant settings).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');

  await knex.schema.createTable('tenant_settings', (t) => {
    t.uuid('tenant_id').primary().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('timezone', 64).notNullable().defaultTo('Asia/Colombo');
    t.string('currency', 3).notNullable().defaultTo('LKR');
    t.smallint('contract_reminder_days').notNullable().defaultTo(30);
    t.smallint('probation_reminder_days').notNullable().defaultTo(14);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Metadata of private objects in MinIO. object_key never leaves the API.
  await tenantTable(
    knex,
    'files',
    (t) => {
      t.string('object_key', 300).notNullable().unique();
      t.string('original_name', 255).notNullable();
      t.string('mime_type', 120).notNullable();
      t.integer('size_bytes').notNullable();
      t.string('purpose', 30).notNullable();
      t.uuid('uploaded_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      // Employee the file belongs to (lets that employee read it via self-service).
      t.uuid('employee_id').nullable();
    },
    { updatedAt: false },
  );

  await knex.raw(
    `ALTER TABLE files ADD CONSTRAINT files_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id) ON DELETE SET NULL (employee_id)`,
  );
  await knex.schema.alterTable('employees', (t) => {
    t.uuid('photo_file_id').nullable();
    t.foreign(['tenant_id', 'photo_file_id'])
      .references(['tenant_id', 'id'])
      .inTable('files')
      .onDelete('SET NULL (photo_file_id)' as 'SET NULL');
  });

  await tenantTable(knex, 'employee_documents', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    tenantRef(t, 'file_id', 'files', 'RESTRICT');
    t.string('category', 20).notNullable();
    t.string('title', 150).notNullable();
    t.date('expiry_date').nullable();
    t.string('notes', 500).nullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  await tenantTable(knex, 'employment_contracts', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.string('contract_number', 40).notNullable();
    t.string('contract_type', 20).notNullable();
    t.date('start_date').notNullable();
    t.date('end_date').nullable();
    t.date('probation_end_date').nullable();
    t.string('status', 20).notNullable().defaultTo('draft');
    tenantRef(t, 'file_id', 'files', 'SET NULL', true);
    tenantRef(t, 'renewed_from_id', 'employment_contracts', 'SET NULL', true);
    t.date('confirmed_on').nullable();
    t.string('notes', 1000).nullable();
  });

  await tenantTable(knex, 'checklist_templates', (t) => {
    t.string('kind', 12).notNullable();
    t.string('title', 200).notNullable();
    t.string('description', 500).nullable();
    t.smallint('due_days').notNullable().defaultTo(0);
    t.smallint('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await tenantTable(knex, 'employee_tasks', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.string('kind', 12).notNullable();
    t.string('title', 200).notNullable();
    t.string('description', 500).nullable();
    t.date('due_date').nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.uuid('completed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.smallint('sort_order').notNullable().defaultTo(0);
  });

  // Append-only audit trail of sensitive actions.
  await tenantTable(
    knex,
    'audit_logs',
    (t) => {
      t.uuid('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.string('action', 60).notNullable();
      t.string('entity_type', 40).notNullable();
      t.uuid('entity_id').nullable();
      t.jsonb('data').nullable();
      t.index(['tenant_id', 'created_at']);
      t.index(['tenant_id', 'entity_type', 'entity_id']);
    },
    { updatedAt: false },
  );

  // ── Generic approval workflow ──────────────────────────────────
  await tenantTable(knex, 'workflow_definitions', (t) => {
    t.string('entity_type', 40).notNullable();
    t.string('name', 150).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'entity_type']);
  });
  await tenantTable(knex, 'workflow_steps', (t) => {
    tenantRef(t, 'definition_id', 'workflow_definitions', 'CASCADE');
    t.smallint('step_order').notNullable();
    t.string('approver_type', 10).notNullable();
    t.uuid('role_id').nullable().references('id').inTable('roles').onDelete('CASCADE');
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.unique(['definition_id', 'step_order']);
  });
  await tenantTable(knex, 'approval_requests', (t) => {
    t.string('entity_type', 40).notNullable();
    t.uuid('entity_id').notNullable();
    t.string('title', 200).notNullable();
    t.uuid('requester_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    tenantRef(t, 'subject_employee_id', 'employees', 'CASCADE', true);
    t.jsonb('steps').notNullable(); // snapshot of the definition at submission
    t.smallint('current_step').notNullable().defaultTo(1);
    t.string('status', 12).notNullable().defaultTo('pending');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.unique(['tenant_id', 'entity_type', 'entity_id']);
    t.index(['tenant_id', 'status']);
  });
  await tenantTable(
    knex,
    'approval_actions',
    (t) => {
      tenantRef(t, 'request_id', 'approval_requests', 'CASCADE');
      t.smallint('step_order').notNullable();
      t.uuid('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('on_behalf_of').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.string('decision', 12).notNullable();
      t.string('comment', 1000).nullable();
      t.string('from_status', 12).notNullable();
      t.string('to_status', 12).notNullable();
    },
    { updatedAt: false },
  );
  await tenantTable(knex, 'approval_delegations', (t) => {
    t.uuid('from_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('to_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
  });

  // ── Notifications ──────────────────────────────────────────────
  await tenantTable(
    knex,
    'notifications',
    (t) => {
      t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('type', 40).notNullable();
      t.string('title', 200).notNullable();
      t.string('body', 1000).nullable();
      t.string('link', 300).nullable();
      t.string('dedupe_key', 200).notNullable();
      t.timestamp('read_at', { useTz: true }).nullable();
      t.unique(['tenant_id', 'user_id', 'dedupe_key']);
      t.index(['user_id', 'tenant_id', 'read_at']);
    },
    { updatedAt: false },
  );
  await knex.schema.createTable('notification_preferences', (t) => {
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 40).notNullable();
    t.boolean('in_app').notNullable().defaultTo(true);
    t.boolean('email').notNullable().defaultTo(false);
    t.primary(['tenant_id', 'user_id', 'type']);
  });

  await tenantTable(knex, 'announcements', (t) => {
    t.string('title', 200).notNullable();
    t.text('body').notNullable();
    t.date('publish_on').notNullable();
    t.date('expires_on').nullable();
    t.boolean('is_pinned').notNullable().defaultTo(false);
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  // Self-service change to sensitive profile fields, applied only after approval.
  await tenantTable(knex, 'profile_change_requests', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.jsonb('changes').notNullable();
    t.string('reason', 500).nullable();
    t.string('status', 12).notNullable().defaultTo('pending');
  });

  await knex.raw(`
    ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_category_check CHECK (category IN (${list(DOCUMENT_CATEGORIES)}));
    ALTER TABLE employment_contracts
      ADD CONSTRAINT contracts_type_check CHECK (contract_type IN (${list(CONTRACT_TYPES)})),
      ADD CONSTRAINT contracts_status_check CHECK (status IN (${list(CONTRACT_STATUSES)})),
      ADD CONSTRAINT contracts_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
      ADD CONSTRAINT contracts_no_overlap EXCLUDE USING gist (
        tenant_id WITH =, employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      ) WHERE (status = 'active');
    CREATE UNIQUE INDEX contracts_number_unique ON employment_contracts (tenant_id, lower(contract_number));
    ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_kind_check CHECK (kind IN ('onboarding','exit'));
    ALTER TABLE employee_tasks ADD CONSTRAINT employee_tasks_kind_check CHECK (kind IN ('onboarding','exit'));
    ALTER TABLE workflow_steps
      ADD CONSTRAINT workflow_steps_type_check CHECK (approver_type IN (${list(APPROVER_TYPES)})),
      ADD CONSTRAINT workflow_steps_target_check CHECK (
        (approver_type = 'manager' AND role_id IS NULL AND user_id IS NULL) OR
        (approver_type = 'role' AND role_id IS NOT NULL) OR
        (approver_type = 'user' AND user_id IS NOT NULL));
    ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_status_check CHECK (status IN (${list(APPROVAL_STATUSES)}));
    ALTER TABLE approval_actions ADD CONSTRAINT approval_actions_decision_check CHECK (decision IN ('submitted','approved','rejected','cancelled'));
    -- One decision per step: concurrent approvers cannot both decide the same step.
    CREATE UNIQUE INDEX approval_actions_one_decision ON approval_actions (request_id, step_order) WHERE decision IN ('approved','rejected');
    ALTER TABLE approval_delegations ADD CONSTRAINT approval_delegations_check CHECK (end_date >= start_date AND from_user_id <> to_user_id);
    ALTER TABLE profile_change_requests ADD CONSTRAINT profile_change_status_check CHECK (status IN (${list(APPROVAL_STATUSES)}));
  `);
}

export async function down(knex: Knex): Promise<void> {
  for (const t of [
    'profile_change_requests',
    'announcements',
    'notification_preferences',
    'notifications',
    'approval_delegations',
    'approval_actions',
    'approval_requests',
    'workflow_steps',
    'workflow_definitions',
    'audit_logs',
    'employee_tasks',
    'checklist_templates',
    'employment_contracts',
    'employee_documents',
  ])
    await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('employees', (t) => t.dropColumn('photo_file_id'));
  await knex.schema.dropTableIfExists('files');
  await knex.schema.dropTableIfExists('tenant_settings');
}
