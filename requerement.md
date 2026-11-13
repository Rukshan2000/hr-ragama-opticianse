# Role: Senior HRMS Software Architect, Senior Full-Stack Engineer & Product Designer

You are responsible for transforming the existing HR Ragama boilerplate into a complete, functional, production-ready Human Resource Management System (HRMS).

You must work as a senior software architect, backend engineer, frontend engineer, database designer, QA engineer, and creative UI/UX designer.

## 1. First: Understand the existing project

Before writing or changing any code:

1. Read all applicable `AGENTS.md` files and repository-specific agent instructions.
2. Read the root README and all relevant architecture documentation.
3. Inspect both `main-frontend` and `main-backend`.
4. Inspect existing authentication, authorization, tenant handling, database migrations, seeders, API conventions, UI components, hooks, navigation, and testing infrastructure.
5. Identify existing reusable components and functionality.
6. Check the current Git status. Never overwrite or remove unrelated user changes.
7. Create a written implementation plan based on the actual repository.

Do not assume the architecture described in documentation perfectly matches the current code. Verify it.

**Critical:** Do not replace the existing boilerplate architecture, authentication, BFF, API client, RBAC, or database infrastructure.

## 2. Existing technology stack — preserve it

### Frontend
- Next.js 16 App Router
- React 19
- TypeScript strict mode
- Tailwind CSS 4
- shadcn / existing Base UI components
- Lucide icons
- TanStack Query 5
- React Hook Form
- Zod 4

### Backend
- Node.js 22
- Fastify 5
- TypeScript strict mode
- Knex 3
- PostgreSQL 16
- Zod validation
- Vitest
- Swagger / OpenAPI

### Architecture
- Modular monolith
- Feature-based modules
- Route → Controller → Service → Repository
- Database migrations
- Shared schema multi-tenancy
- Tenant isolation using `tenant_id`
- RBAC using `resource:action` permissions
- Frontend BFF with HttpOnly cookies

Follow all existing conventions.

## 3. HRMS modules to implement

Build the following modules as complete, interconnected features.

### Module A: Organization Management

Implement:
- Organizations
- Branches
- Departments
- Designations / job titles
- Organization levels
- Reporting hierarchy
- Organization chart

Organization chart requirements:
- Support parent-child organization structures.
- Use a normalized relational database design.
- Store organization levels in a separate table.
- Store organizational units with parent references and level references.
- Do not assign employees to organization chart nodes.
- Employee department and designation assignments must be maintained in the employee module.
- Provide a graphical organization chart with expand/collapse, zoom, search and detail views.

### Module B: Employee Management

Implement complete employee lifecycle management.

Employee information:
- Employee number (unique within tenant)
- First name
- Last name
- Display name
- Email
- Phone number
- Date of birth
- Gender
- Address
- Emergency contact
- Profile photo
- Employee status
- Joining date
- Employment type
- Department
- Designation
- Reporting manager
- Branch
- Probation start/end dates
- Confirmation date
- Resignation date
- Termination date
- Notes

Additional functionality:
- Employee list with server-side pagination.
- Search and filtering.
- Create/edit employee.
- Employee detail page.
- Employee profile tabs.
- Employee document uploads.
- Employment history.
- Department transfer.
- Designation changes.
- Manager changes.
- Employee activation/deactivation.
- Employee onboarding.
- Employee exit management.

Keep employee personal data separate from user authentication accounts.

An employee should be able to exist without a login account.

### Module C: Employment & Contract Management

Implement:
- Employment contracts
- Contract types
- Permanent, temporary, contract and internship employment
- Contract start/end dates
- Probation tracking
- Confirmation workflow
- Contract document storage
- Contract renewal reminders
- Employment status history

### Module D: Attendance Management

Implement:
- Daily attendance
- Check-in/check-out
- Manual attendance entry
- Attendance correction requests
- Attendance approval
- Late arrivals
- Early departures
- Missing attendance
- Working hours
- Overtime
- Break times
- Attendance reports

Support multiple attendance sources:
- Manual
- Admin entry
- Future biometric/device integrations

Create configurable attendance policies.

Do not assume one fixed working schedule for all organizations.

### Module E: Shift & Work Schedule Management

Implement:
- Shift creation
- Shift assignment
- Multiple shifts
- Rotational shifts
- Weekly schedules
- Working days
- Weekend configurations
- Public holidays
- Organization-specific holidays
- Grace periods
- Overnight shifts

Handle timezone correctly using PostgreSQL `timestamptz` and organization timezone settings.

### Module F: Leave Management

Implement:
- Leave types
- Annual leave
- Casual leave
- Medical leave
- Unpaid leave
- Other configurable leave types
- Leave entitlement policies
- Employee leave balances
- Leave accrual
- Leave applications
- Half-day leave
- Multiple-day leave
- Leave cancellation
- Leave approval
- Leave rejection with reason
- Leave history
- Team leave calendar

Prevent overlapping approved leave requests and invalid leave balances.

Support configurable approval levels.

### Module G: Holiday Management

Implement:
- Public holidays
- Company holidays
- Branch-specific holidays
- Holiday calendars
- Recurring holidays
- Holiday reports

### Module H: Payroll Management

Implement a configurable payroll engine.

Employee compensation:
- Basic salary
- Allowances
- Bonuses
- Commissions
- Overtime payments
- Deductions
- Loans and advances
- Salary revisions

Payroll processing:
- Monthly payroll periods
- Payroll calculation
- Attendance-based calculations
- Leave deductions
- Overtime calculations
- Employer contributions
- Employee contributions
- Payslip generation
- Payroll approval
- Payroll locking
- Payroll history
- Payroll reports

Sri Lankan payroll support:
- Configurable EPF employee contribution
- Configurable EPF employer contribution
- Configurable ETF contribution
- Configurable APIT/tax rules
- Effective-dated payroll policies

Do not hardcode tax rates or statutory contribution rates. Store them as effective-dated configurations and make them configurable by authorized payroll administrators.

Keep employee payroll data private and restrict permissions.

Never silently recalculate or modify a finalized payroll. Require an authorized correction or adjustment workflow.

### Module I: Recruitment Management

Implement:
- Job vacancies
- Job descriptions
- Applicant profiles
- CV/document uploads
- Application tracking
- Interview scheduling
- Interview evaluations
- Candidate status tracking
- Candidate selection
- Offer management
- Recruitment reports

Support conversion of selected candidates into employees without duplicating records.

### Module J: Employee Self-Service

Create a dedicated employee experience.

Employees should be able to:
- View their profile
- Update permitted personal details
- Upload documents
- View attendance
- View leave balance
- Apply for leave
- Track leave applications
- View work schedule
- View payslips
- View company announcements
- Submit correction requests

Changes to sensitive employee information must require appropriate HR approval.

### Module K: Performance Management

Implement:
- Performance cycles
- Employee goals
- KPIs
- Manager evaluations
- Self-assessments
- Performance reviews
- Feedback
- Review history

### Module L: Asset Management

Implement:
- Asset categories
- Asset registration
- Asset inventory
- Employee asset assignments
- Asset return
- Asset condition
- Assignment history
- Asset reports

### Module M: Expense Management

Implement:
- Expense categories
- Expense claims
- Receipts
- Reimbursement requests
- Approval workflows
- Reimbursement status
- Expense reports

### Module N: Training & Development

Implement:
- Training programs
- Courses
- Employee enrollment
- Training completion
- Certifications
- Expiry reminders
- Training history

### Module O: Employee Exit Management

Implement:
- Resignation requests
- Resignation approvals
- Notice period
- Last working day
- Exit interviews
- Asset clearance
- Department clearance
- Final settlement records
- Employee status update
- Exit reports

## 4. Shared workflow engine

Build reusable approval infrastructure.

Do not implement independent hardcoded approval systems for every module.

The workflow engine should support:
- Workflow definitions
- Approval steps
- Sequential approvals
- Multiple approvers where appropriate
- Manager-based approval
- Role-based approval
- Specific-user approval
- Approve/reject
- Rejection reasons
- Approval history
- Delegation where authorized
- Notifications
- Workflow activation/deactivation

Use a generic workflow entity reference with strict tenant isolation.

Every approval must retain:
- Requester
- Approver
- Decision
- Decision timestamp
- Comments
- Previous and current state

Ensure concurrent approval requests cannot cause duplicate or inconsistent decisions.

## 5. Notification system

Implement reusable notifications.

Support:
- In-app notifications
- Email notifications through the existing mailer
- Unread/read status
- Notification preferences

Notification events:
- Leave submitted
- Leave approved/rejected
- Attendance correction submitted
- Payroll finalized
- Contract expiration approaching
- Probation completion approaching
- Employee onboarding
- Asset assigned/returned
- Approval pending

Do not send duplicate notifications for the same event.

## 6. Database design requirements

Use PostgreSQL and existing Knex migration conventions.

Rules:
- UUID primary keys.
- `tenant_id` on every tenant-owned business table.
- `created_at`, `updated_at`.
- `deleted_at` for soft-deletable entities where appropriate.
- Foreign keys with explicit delete behavior.
- Proper indexes.
- Unique constraints.
- Check constraints where appropriate.
- Effective-dated records for changing policies and salary configurations.
- Transactions for multi-table operations.

Use normalized relational design. Avoid unnecessary duplicated data and giant generic tables.

Maintain employee information separately from login accounts.

Use consistent naming conventions based on the existing repository.

Do not modify existing auth tables unnecessarily.

For every module:
1. Create migrations.
2. Create repositories.
3. Create services.
4. Create controllers.
5. Create routes.
6. Create Zod schemas.
7. Register permissions.
8. Add idempotent seed data where appropriate.
9. Add integration tests.

Use `tenantScope()` for tenant-owned database queries.

Never trust `tenant_id` supplied by the client. Derive tenant context from the authenticated request.

## 7. RBAC and security

Extend the existing permission catalog.

Create granular permissions, for example:

- employees:read
- employees:create
- employees:update
- employees:delete
- employees:manage
- organization:read
- organization:manage
- attendance:read
- attendance:manage
- leave:read
- leave:create
- leave:approve
- payroll:read
- payroll:manage
- payroll:approve
- recruitment:manage
- assets:manage
- performance:manage
- expenses:approve
- reports:read

Permissions must be enforced on the backend.

Create sensible default roles:
- HR Administrator
- HR Manager
- Department Manager
- Team Leader
- Employee
- Payroll Officer
- Recruiter

Do not grant excessive permissions by default.

Ensure:
- Cross-tenant data access is impossible.
- Unauthorized records return 404 where appropriate.
- Employees cannot read other employees' confidential information without permission.
- Payroll access is strictly restricted.
- Sensitive actions are audited.
- All input is validated.
- File uploads are validated and secured.

## 8. Frontend design requirements

Act as an experienced enterprise SaaS product designer.

Build a premium, modern, responsive HRMS interface.

Design principles:
- Clean enterprise dashboard.
- Professional typography.
- Consistent spacing.
- Strong information hierarchy.
- Responsive layouts.
- Excellent data tables.
- Accessible forms.
- Clear empty/loading/error states.
- Useful filters and search.
- Consistent dialogs and confirmation flows.
- Light and dark mode.

Reuse the existing theme system, design tokens, UI primitives and shared components.

Avoid:
- Generic template-like dashboards.
- Excessive gradients.
- Unnecessary animations.
- Oversized cards.
- Excessive rounded corners.
- Fake charts.
- Placeholder buttons.
- Nonfunctional interactions.

Create a consistent sidebar with grouped navigation:

**Overview**
- Dashboard

**Organization**
- Organization Chart
- Branches
- Departments
- Designations
- Organization Levels

**People**
- Employees
- Employee Documents
- Employment Contracts
- Onboarding
- Exit Management

**Time & Attendance**
- Attendance
- Shifts
- Work Schedules
- Holidays

**Leave**
- Leave Requests
- Leave Types
- Leave Policies
- Leave Calendar

**Payroll**
- Salary Structures
- Payroll Processing
- Payslips
- Payroll Reports

**Talent**
- Recruitment
- Vacancies
- Applicants
- Performance
- Training

**Administration**
- Assets
- Expenses
- Workflows
- Announcements
- Reports
- Settings

Navigation must be permission-aware using the existing navigation configuration.

## 9. Dashboard

Build a real dashboard using database-backed data.

Include:
- Total employees
- Active employees
- New joiners
- Employees on leave today
- Attendance summary
- Late arrivals
- Pending approvals
- Upcoming birthdays
- Upcoming contract expirations
- Payroll status
- Recent HR activities

Charts should use real API data, not hardcoded values.

Dashboard data must respect tenant and user permissions.

## 10. Reports & exports

Implement reports with:
- Server-side filtering
- Date ranges
- Branch filters
- Department filters
- Employee filters
- CSV export
- Excel export where appropriate
- PDF generation for payslips and formal documents

Restrict sensitive report exports by permission.

## 11. File management

Use the existing file-storage architecture if available.

Support secure employee documents, CVs, contracts, receipts, profile photos and payslips.

Do not expose private documents through publicly accessible URLs.

Validate MIME type, file size and file extension. Enforce authorization when retrieving files.

## 12. Testing requirements

Write meaningful tests for all critical functionality.

Backend:
- Service unit tests
- API integration tests
- Tenant isolation tests
- Permission tests
- Validation tests
- Workflow tests
- Attendance calculation tests
- Leave balance tests
- Payroll calculation tests

Frontend:
- Form validation
- List and filtering behavior
- Permission-aware navigation
- Critical employee workflows
- Error and loading states

Test important edge cases:
- Duplicate employee numbers
- Duplicate leave requests
- Overlapping attendance periods
- Cross-tenant record access
- Unauthorized approval
- Payroll recalculation
- Concurrent approvals
- Missing attendance
- Overnight shifts
- Timezone differences

## 13. Development execution strategy

Do not attempt to build everything in one enormous uncontrolled code change.

Implement in dependency order.

### Stage 1 — Foundation
- Review repository and agent rules.
- Define HR domain model.
- Create implementation roadmap.
- Extend permissions.
- Establish shared HR utilities.
- Build organization management.

### Stage 2 — Core HR
- Employee management.
- Employee profiles.
- Employment contracts.
- Employee documents.
- Onboarding and exit.

### Stage 3 — Time management
- Shift management.
- Work schedules.
- Attendance.
- Holiday management.
- Leave management.

### Stage 4 — Workflow infrastructure
- Approval engine.
- Notifications.
- Audit integration.

### Stage 5 — Payroll
- Salary structures.
- Payroll policies.
- Payroll calculations.
- Payslips.
- Payroll approvals.

### Stage 6 — Advanced HR
- Recruitment.
- Performance.
- Training.
- Asset management.
- Expense management.

### Stage 7 — Employee portal
- Employee self-service.
- Personal profile.
- Leave applications.
- Attendance.
- Payslips.

### Stage 8 — Reporting and quality
- Dashboard analytics.
- Reports and exports.
- Security audit.
- Performance optimization.
- Full regression tests.

After each stage:
1. Run migrations.
2. Run relevant tests.
3. Run TypeScript checks.
4. Run ESLint.
5. Run production builds where applicable.
6. Fix failures before moving forward.
7. Update implementation documentation.

## 14. Important implementation rules

- Do not stop after generating a plan. Start implementing.
- Do not create frontend-only mock features.
- Do not create API endpoints that return fake data.
- Every visible action must perform a real operation or be explicitly marked as unavailable.
- Do not silently skip difficult features.
- Do not duplicate existing infrastructure.
- Do not use unnecessary dependencies.
- Do not bypass RBAC.
- Do not bypass tenant isolation.
- Do not put database queries in controllers.
- Do not put business logic in repositories.
- Do not use raw SQL outside the repository layer unless the existing architecture explicitly requires it.
- Do not delete existing functionality.
- Do not weaken authentication or security.
- Use transactions for important multi-table changes.
- Make migrations reversible where practical.
- Keep modules independently maintainable.
- Document important business rules.
- Ask questions only when a genuine business decision cannot reasonably be handled through configurable defaults.

## 15. Definition of done

The HRMS is not complete just because screens exist.

A module is complete only when:

- Database schema exists.
- Migrations execute successfully.
- Backend APIs work.
- Validation works.
- RBAC works.
- Tenant isolation works.
- Frontend is connected to real APIs.
- Create, read, update and delete operations work where applicable.
- Search, filters and pagination work.
- Loading, empty and error states work.
- Audit history exists for important actions.
- Tests pass.
- Documentation is updated.

## 16. Final delivery

Maintain these project documents:

- `docs/HRMS_IMPLEMENTATION_PLAN.md`
- `docs/HRMS_DATABASE_DESIGN.md`
- `docs/HRMS_MODULE_STATUS.md`
- `docs/HRMS_BUSINESS_RULES.md`

At the end, report:
1. Modules completed.
2. Modules partially completed.
3. Database migrations created.
4. APIs implemented.
5. Frontend pages implemented.
6. Permissions added.
7. Tests executed and results.
8. Build status.
9. Remaining work and known limitations.
10. Instructions to run the complete system.

**Final instruction:** Build a real, maintainable, secure, full-stack HRMS using the existing boilerplate. Prioritize correctness, tenant isolation, business workflows, data integrity and usability over speed or superficial feature counts.