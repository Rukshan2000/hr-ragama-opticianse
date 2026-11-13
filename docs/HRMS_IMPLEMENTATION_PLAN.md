# HRMS Implementation Plan

Fastify modular monolith + Next.js BFF. Route → Controller/handler → Service → Repository, Zod validation, `tenantScope()`, `resource:action` RBAC.

| Stage | Scope | Status |
|---|---|---|
| 1 Foundation | Permissions, roles, organization | Done |
| 2 Core HR | Employees, documents, photo, contracts, onboarding/exit checklists | Done |
| 3 Time | Shifts, schedules, attendance, holidays, leave | Done |
| 4 Workflow | Approval engine, notifications, audit log | Done |
| 5 Payroll | Salaries, statutory policies, runs, payslips (PDF) | Done |
| 6 Advanced | Recruitment, performance, training, assets, expenses, exit | Done |
| 7 Self-service | `/me` portal | Done |
| 8 Reporting | Dashboard, reports, CSV/Excel exports | Done |

## Shared building blocks (added)
- `modules/hr-common/crud.ts` — repository/service/routes factory for flat resources (≈25 resources).
- `modules/hr-common/me.ts` — current employee, row-level access (`canAccessEmployee`, always tenant-checked), tenant time zone.
- `modules/hr-common/audit.ts` — audit row inside the caller's transaction.
- `modules/workflow` — `registerApprovalHandler(entityType, …)`; modules call `workflowService.submit/cancel`.
- `modules/notifications` — `notify()` with dedupe keys and preferences.
- `shared/utils/storage.ts` (MinIO, in-memory in tests), `shared/utils/pdf.ts` (dependency-free PDF).
- `modules/jobs.ts` — hourly: contract/probation reminders, certificate expiry, mark yesterday's missing attendance.
- Frontend `features/hr/kit.tsx` — generic CRUD page/dialog, reference selects, file upload, tabs; BFF now streams binary uploads/downloads.

## Next steps
1. Configure an SMTP/API mail provider in `shared/utils/mailer.ts`.
2. Verify the seeded statutory sample (EPF/ETF/APIT) against current regulations before real payroll.
3. Optional: real .xlsx writer, frontend test runner, device/biometric ingestion endpoint (attendance `source: device` already supported by `POST /attendance`).
