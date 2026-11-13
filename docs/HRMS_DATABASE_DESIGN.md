# HRMS Database Design

All tables: UUID PK, `tenant_id` → `tenants` ON DELETE CASCADE, `created_at`/`updated_at` with trigger.

## Organization (`20260201000001_create_organization`)
| Table | Key columns | Constraints |
|---|---|---|
| `branches` | code, name, address, phone, email, timezone (IANA), is_active | UNIQUE(tenant_id, code) |
| `departments` | code, name, description, is_active | UNIQUE(tenant_id, code) |
| `designations` | code, name (job title), description, is_active | UNIQUE(tenant_id, code) |
| `org_levels` | name, rank (1 = top) | UNIQUE(tenant_id, name), UNIQUE(tenant_id, rank), rank > 0 |
| `org_units` | name, code, parent_id, level_id, department_id, sort_order | composite tenant FKs (RESTRICT), parent ≠ self, partial UNIQUE(tenant_id, code) |

Employees are **not** attached to chart nodes. A unit may optionally link to the department it represents.

## Employees (`20260201000002_create_employees`)
`employees`: personal fields, emergency contact, status, employment_type, joining/probation/confirmation/resignation/termination dates,
department_id, designation_id, branch_id, manager_id (self), optional user_id (login account), notes, `deleted_at`.

- Partial unique indexes (live rows only): `(tenant_id, lower(employee_number))`, `(tenant_id, lower(email))`, `(tenant_id, user_id)`.
- CHECKs: status, employment_type, gender enums; manager ≠ self; probation end ≥ start; DOB < joining date.
- Composite tenant FKs to departments/designations/branches/employees (RESTRICT).

`employee_history` (append-only): field (joined|department|designation|branch|manager|status|employment_type),
old_value, new_value, effective_date, reason, changed_by → users. FK `(tenant_id, employee_id)` CASCADE.

## Stages 2–8 (migrations `20260301000001`–`…004`)
Every table: uuid PK, `tenant_id` (cascade), timestamps, `UNIQUE(tenant_id,id)`; child references are composite `(tenant_id, x_id)` FKs so cross-tenant links are impossible.

- **Core/workflow:** `tenant_settings`, `files` (private MinIO metadata, `employee_id` owner), `employee_documents`, `employment_contracts` (EXCLUDE overlapping active contracts), `checklist_templates`, `employee_tasks`, `audit_logs`, `workflow_definitions`, `workflow_steps`, `approval_requests` (UNIQUE per entity, steps snapshot), `approval_actions` (UNIQUE one decision per step), `approval_delegations`, `notifications` (UNIQUE dedupe key per user), `notification_preferences`, `announcements`, `profile_change_requests`. `employees.photo_file_id`.
- **Time:** `shifts`, `work_schedules`, `work_schedule_days`, `employee_schedules` (EXCLUDE overlap), `attendance_policies` (effective-dated), `attendance_records` (UNIQUE employee+date, timestamptz punches), `attendance_corrections`, `holidays`, `leave_types`, `leave_policies` (effective-dated, optional employment type), `leave_balances` (UNIQUE employee+type+year), `leave_requests` (EXCLUDE overlapping live full-day requests).
- **Payroll:** `salary_components`, `employee_salaries` (effective-dated revisions), `employee_salary_items`, `payroll_policies` (effective-dated EPF/ETF/APIT brackets jsonb), `employee_loans`, `payroll_runs` (UNIQUE year+month), `payroll_adjustments`, `payslips` (trigger blocks writes once the run is approved/locked).
- **Talent/admin:** `vacancies`, `applicants`, `job_applications`, `interviews`, `performance_cycles/reviews/goals/feedback`, `training_programs/enrollments`, `asset_categories`, `assets`, `asset_assignments` (one open assignment per asset), `expense_categories`, `expense_claims`, `exit_cases` (one open per employee), `exit_clearances`.
- Requires `btree_gist` (created by the migration).
