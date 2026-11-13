# HRMS Business Rules

## Organization
- Codes are upper-cased and unique per tenant. Deleting master data still referenced → 409; deactivate instead.
- A unit's level rank must be greater (deeper) than its parent's; its children must remain deeper than it.
- A unit can't move under itself or a descendant. Structural edits take a per-tenant advisory lock, so concurrent moves cannot create cycles.
- A level's rank can't change while units use it. A unit with sub-units can't be deleted.

## Employees
- An employee can exist without a login account (`user_id` optional).
- Employee number and email are unique per tenant among non-archived employees (case-insensitive). Archived numbers can be reused.
- Department/designation/branch/manager changes go through `POST /employees/:id/assignment` and write one history row per changed field with an effective date and reason.
- Reporting loops are rejected (recursive chain check, depth-capped at 100).
- Status transitions:
  - onboarding → probation | active | inactive
  - probation → active | on_notice | inactive | terminated
  - active → on_notice | inactive | resigned | terminated
  - on_notice → active | resigned | terminated
  - inactive → active
  - resigned and terminated are final.
- Side effects: probation sets probation_start_date; active sets confirmation_date; on_notice/resigned set resignation_date; terminated sets termination_date. The effective date can't precede joining.
- Assignment and status changes lock the employee row (`FOR UPDATE`), so concurrent changes serialise; only one of two racing transitions succeeds.
- An employee with direct reports can't be archived.

## Permissions (defaults)
| Role | Permissions |
|---|---|
| Admin | everything tenant-scoped |
| HR Administrator | organization:read/manage, employees:* , users:read |
| HR Manager | organization:read, employees:read/create/update/manage |
| Department Manager | organization:read, employees:read |
| Team Leader, Employee | organization:read |

`employees:read` exposes personal data, so ordinary employees don't get it. Self-service (own record) comes in Stage 7.
Payroll Officer and Recruiter roles will be added with their modules.

## Stages 2–8 rules
**Files:** extension + magic bytes must agree; max 10 MB; stored privately in MinIO (`MINIO_BUCKET`); downloads only through the API after authorization (purpose permission, own/managed employee, or uploader); other tenants get 404.
**Contracts:** start as draft; activation syncs the employee's employment type (history row); fixed-term needs an end date; renewal ends the old contract the day before; confirmation moves probation → active.
**Workflow:** default = one manager step; no reachable manager → holders of the module's approve permission. Requesters never approve their own request. Holders of the approve permission may decide any step. Delegations apply to manager/user steps. Rejection requires a reason. Row lock + unique index ⇒ exactly one decision per step.
**Attendance:** times are timestamptz; the work date and shift window use the branch time zone (else tenant). Late counts only beyond grace; early leave beyond early grace; overtime only above the policy threshold; below half-day minutes ⇒ half day; work on days off/holidays may be all overtime. Periods may not overlap; one record per employee per day.
**Leave:** days = scheduled working days minus holidays (Mon–Fri when unscheduled). Live requests can't overlap (two different half days are allowed). Balance = accrued + carried + adjustment − used − pending; blocked when insufficient unless the type allows negative. Approved leave can be cancelled by the employee only before it starts.
**Payroll:** rates come only from the effective policy. Gross = prorated basic − no-pay + earnings + OT; EPF/ETF on basic + EPF-applicable items; APIT progressive on taxable pay. Approve finalizes (immutable, loans recovered, staff notified); finalized periods reject recalculation, deletion and new adjustments—corrections go into a later period.
**Exit:** approval ⇒ on notice + clearance list; Assets clearance requires all assets returned; completion requires every clearance ⇒ resigned/terminated with history.
**Self-service:** contact fields save directly; name, email, date of birth, gender need HR approval.

## Default roles (now)
Admin (all), HR Administrator (HR + payroll read, recruitment, workflows, audit, settings), HR Manager (HR operations, no payroll), Department Manager (team read, attendance/leave read, reports), Team Leader, Employee (self-service), Payroll Officer (payroll manage, no approve), Recruiter. Payroll approval (`payroll:approve`) is Admin-only by default.
