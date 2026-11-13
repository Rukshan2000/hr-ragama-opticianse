# HRMS Module Status

| Module | Status | Notes |
|---|---|---|
| A Organization | ✅ | Branches, departments, designations, levels, org chart |
| B Employees | ✅ | + documents (MinIO), profile photo, onboarding/exit checklists, login-account linking |
| C Contracts | ✅ | Draft→active, renew, terminate, probation confirmation, one active contract per period (DB exclusion), expiry reminders |
| D Attendance | ✅ | Self check-in/out, admin/manual/device entry, late/early/OT/breaks, missing → absent (hourly job), corrections via workflow, summary report |
| E Shifts & schedules | ✅ | Shifts (grace, overnight), rotating weekly schedules, effective-dated assignments, branch/tenant time zones |
| F Leave | ✅ | Types, effective-dated policies, accrual (annual/monthly), carry-forward, balances & adjustments, half days, overlap prevention, approval/cancel, team calendar |
| G Holidays | ✅ | Public/company, branch-specific, recurring; calendar & report |
| H Payroll | ✅ | Components, salary revisions, loans, adjustments, effective-dated EPF/ETF/APIT policies, attendance/no-pay/OT calc, approve (immutable, DB trigger), lock, PDF payslips, register export |
| I Recruitment | ✅ | Vacancies, applicants + CV, pipeline, interviews/evaluations, offers, hire → employee (no duplicate) |
| J Self-service | ✅ | /me: profile (sensitive changes need approval), check-in, leave, attendance, corrections, schedule, payslips, documents, expenses, assets, reviews, resignation, announcements |
| K Performance | ✅ | Cycles, launch, goals/KPIs, self + manager evaluation, feedback |
| L Assets | ✅ | Categories, inventory, assign/return with condition, history, register report |
| M Expenses | ✅ | Categories (limits, receipt rule), claims with receipts, workflow approval, reimbursement |
| N Training | ✅ | Programs, enrollments, completion, certificates with expiry + reminders |
| O Exit | ✅ | Resignation/termination via workflow → on notice, clearance (assets enforced), interview, settlement, completion → resigned/terminated |
| Workflow engine | ✅ | Manager/role/user steps, sequential, delegation, HR override, concurrency-safe, full history |
| Notifications | ✅ | In-app bell, preferences, email via mailer hook (dev logs), dedupe keys |
| Dashboard / reports | ✅ | Permission-aware real-data dashboard; 10 reports with CSV + Excel (SpreadsheetML) export |

## Known limitations
- Email delivery: the mailer still logs in development and warns in production (no SMTP provider configured).
- Excel export is SpreadsheetML (.xls); Excel shows a format notice on open.
- Payroll does not split a salary revision mid-month (latest revision ≤ period end applies; joiners/leavers are prorated).
- Leave requests cannot cross 31 Dec (split them).
- Approval inbox resolves approvers in memory (cap 500 open requests per tenant).
- Uploaded-but-never-attached files are not garbage-collected.
- Frontend has no automated test runner (none in the boilerplate); verified by typecheck, lint, build and manual browser checks.

## Verification (2026-11-14)
- Backend: typecheck ✅, lint ✅, 17 files / 130 tests ✅ (new: 14 unit — time zones, overnight shifts, attendance, payroll math, accrual, file sniffing, CSV injection, PDF; 11 integration — leave workflow incl. concurrent approvals, multi-step workflow, half days, payroll finalize/immutability/RBAC, attendance overlap & corrections, files authz & tenant isolation, contracts, expenses, exit, recruitment hire, reports, self-service approvals), build ✅. Live MinIO upload/download verified.
- Frontend: typecheck ✅, lint ✅, `next build` ✅ (50 routes). Browser-checked dashboard, schedules, salaries, reports, /me.
