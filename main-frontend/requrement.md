# Claude Code Prompt: Premium Next.js SaaS Frontend

Act as a Senior Frontend Architect, UI/UX Designer and Next.js Engineer.

Your task is to design and implement a production-ready, premium, modern, minimalistic SaaS frontend that integrates with the existing Node.js Fastify backend.

The frontend must look like a professionally designed commercial SaaS product, not a generic admin dashboard template.

## 1. First: Inspect the Existing Backend

Before writing frontend code:

1. Inspect the existing backend repository and its documentation.
2. Understand the API architecture, endpoints, authentication, authorization and response formats.
3. Inspect Swagger/OpenAPI documentation if available.
4. Identify available modules:
   - Authentication
   - Users
   - Roles
   - Permissions
   - Tenants
   - Health checks
5. Understand pagination, filtering, sorting and error response conventions.
6. Build the frontend around the actual backend API.

IMPORTANT:
- Do not invent backend endpoints.
- Do not modify the existing backend.
- Do not assume functionality that the API does not support.
- Do not use fake data for production functionality.
- Use mock data only for isolated design previews when absolutely necessary.

## 2. Technology Stack

Use:

- Next.js (latest stable, App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React
- React Hook Form
- Zod
- TanStack Query
- Axios or a well-structured Fetch API client
- Recharts for analytics where required
- Sonner for notifications

Use compatible stable versions.

Follow clean component architecture and reusable design patterns.

## 3. Design Philosophy — Box-Shaped UI

This is the most important design requirement.

Create a unique visual identity based on rounded rectangular box-shaped components.

Every major UI element should follow a consistent box-based design language.

### Shape system

- Main cards: 14px–18px border radius.
- Small cards: 10px–14px border radius.
- Input fields: 10px–12px border radius.
- Buttons: 10px–12px border radius.
- Modals: 18px–22px border radius.
- Dropdowns: 12px–14px border radius.
- Sidebar containers: 16px–20px border radius.

Never use sharp rectangular corners.

Avoid excessive pill-shaped designs.

Use rounded rectangles rather than circles or completely pill-shaped components, except for small status indicators and avatars.

### Box design rules

- Use clearly separated content containers.
- Maintain consistent spacing between boxes.
- Use subtle borders instead of heavy shadows.
- Use light background contrast to distinguish content sections.
- Keep layouts structured and aligned.
- Use consistent padding inside all cards.
- Avoid unnecessary decorative elements.
- Avoid oversized empty areas.

The UI must feel structured, balanced, clean and premium.

## 4. Custom Color System Using JSON

Create a centralized theme configuration:

`src/config/colors.json`

All UI colors must be controlled through this JSON configuration.

Do not hardcode colors throughout components.

Example:

{
  "brand": {
    "primary": "#0B1F3A",
    "secondary": "#F7931E",
    "accent": "#315B8A"
  },
  "background": {
    "app": "#F5F7FA",
    "surface": "#FFFFFF",
    "subtle": "#EDF1F5",
    "sidebar": "#FFFFFF"
  },
  "text": {
    "primary": "#172337",
    "secondary": "#667085",
    "muted": "#98A2B3",
    "inverse": "#FFFFFF"
  },
  "border": {
    "default": "#E4E9F0",
    "subtle": "#EEF1F5",
    "strong": "#D0D7E2"
  },
  "status": {
    "success": "#16865D",
    "warning": "#D99422",
    "danger": "#D64545",
    "info": "#3478C8"
  }
}

Treat these colors as initial defaults, not fixed limitations.

Requirements:

1. Create a reusable theme provider.
2. Load theme values from colors.json.
3. Generate CSS variables from the configuration.
4. Support light and dark themes.
5. Make brand colors easy to change without editing individual components.
6. Ensure readable text contrast.
7. Use consistent hover, active, focus and disabled states.

Never randomly introduce additional colors.

## 5. Global Layout

Create a premium application layout.

### Sidebar

- Fixed or sticky left sidebar.
- Brand logo and application name.
- Grouped navigation items.
- Minimal Lucide icons.
- Active navigation with subtle background.
- Expandable navigation groups.
- User profile section at the bottom.
- Collapsible sidebar.
- Responsive mobile navigation.

### Top navigation

- Breadcrumb navigation.
- Page title.
- Global search.
- Notifications.
- Theme switcher.
- User profile dropdown.

### Main content

- Consistent maximum width.
- Responsive grid system.
- Proper section spacing.
- Rounded content containers.
- Clear page hierarchy.

The layout must work perfectly on desktop, tablet and mobile.

## 6. Dashboard

Create a professional dashboard containing:

- Welcome section.
- Key statistics cards.
- User count.
- Active users.
- Tenant count.
- System status.
- Recent activities.
- Quick actions.
- Analytics charts where supported.

Use compact, consistent rectangular statistic cards.

Do not fill the dashboard with unnecessary charts.

Use real API data whenever available.

## 7. Authentication UI

Build a premium authentication experience.

Pages:

- Login
- Registration
- Forgot password
- Reset password
- Account activation

Design requirements:

- Minimal split-screen or centered card layout.
- Rounded rectangular form container.
- Clean typography.
- Proper form validation.
- Password visibility toggle.
- Loading states.
- Error messages.
- Success notifications.

Follow the backend authentication contract.

Implement secure token handling. Prefer secure HttpOnly cookie-based sessions where supported by the backend architecture. Never expose refresh tokens in localStorage.

## 8. Management Modules

Build interfaces based on the backend's actual available endpoints.

### Users

- User listing.
- Search.
- Filters.
- Pagination.
- Create user.
- Edit user.
- View user details.
- Activate/deactivate user.
- Role assignment.

### Roles and Permissions

- Role listing.
- Create and edit roles.
- Permission management.
- Permission grouping.
- Role-to-permission assignment.

### Tenants

- Tenant listing.
- Tenant details.
- Tenant status.
- Tenant user management.
- Tenant creation and editing where supported.

Do not expose platform-level functionality to tenant-level users.

Implement permission-aware navigation and action controls.

## 9. Reusable Component Library

Build reusable components:

- AppSidebar
- AppHeader
- PageHeader
- PageContainer
- StatCard
- ContentCard
- DataTable
- SearchInput
- FilterDropdown
- FormField
- TextInput
- SelectInput
- DatePicker
- StatusBadge
- ActionDropdown
- ConfirmDialog
- Drawer
- Modal
- EmptyState
- LoadingState
- ErrorState
- Pagination
- UserAvatar
- Breadcrumbs

Every component must follow the same box-shaped design system.

Avoid creating multiple versions of the same component.

## 10. Tables and Data Management

Create modern data tables with:

- Rounded outer container.
- Clear column spacing.
- Subtle row separators.
- Search.
- Filters.
- Sorting.
- Pagination.
- Row action menus.
- Responsive behavior.
- Loading skeletons.
- Empty states.

Avoid unnecessarily dense enterprise tables.

## 11. API Integration Architecture

Create a centralized API layer.

Suggested structure:

src/
  lib/
    api/
      client.ts
      endpoints.ts
      auth.api.ts
      users.api.ts
      roles.api.ts
      permissions.api.ts
      tenants.api.ts
    hooks/
    utils/
  components/
    ui/
    layout/
    shared/
  features/
    auth/
    dashboard/
    users/
    roles/
    permissions/
    tenants/
  config/
    colors.json
    navigation.ts
  providers/
  app/

Requirements:

- Centralized API client.
- Environment-based API URL.
- Request and response handling.
- Authentication integration.
- Refresh token handling.
- Proper unauthorized handling.
- Standardized error handling.
- API response typing.
- Query caching and invalidation.
- Pagination support.
- Loading and error states.

Use actual backend response structures.

## 12. UX and Interaction

All interactive elements must work.

Implement:

- Form validation.
- Toast notifications.
- Confirmation dialogs.
- Loading indicators.
- Skeleton loaders.
- Empty states.
- Error boundaries.
- Dropdown interactions.
- Sidebar collapse.
- Responsive navigation.
- Search and filtering.
- Keyboard accessibility.

Do not create decorative buttons that do nothing.

## 13. Typography and Spacing

Use a professional modern font such as Inter or Geist.

Typography:

- Clear page headings.
- Medium-weight section headings.
- Readable body text.
- Subtle secondary text.
- Consistent font weights.

Spacing:

- Use a consistent spacing scale.
- Maintain consistent card padding.
- Keep layouts balanced.
- Avoid overcrowding.
- Avoid excessive whitespace.

## 14. Visual Quality Requirements

The final UI must:

- Look like a premium commercial SaaS application.
- Have a strong visual hierarchy.
- Use a consistent box-shaped design language.
- Have no sharp card corners.
- Avoid excessive gradients.
- Avoid unnecessary animations.
- Avoid excessive shadows.
- Avoid random color combinations.
- Avoid generic dashboard styling.
- Avoid oversized typography.
- Avoid excessive pill-shaped components.

Use subtle transitions and professional micro-interactions.

## 15. Implementation Workflow

Phase 1: Inspect backend and API documentation.

Phase 2: Establish the visual direction and color configuration.

Phase 3: Implement global theme, typography and reusable UI components.

Phase 4: Implement responsive application layout.

Phase 5: Implement authentication.

Phase 6: Implement dashboard and management modules.

Phase 7: Integrate all available backend APIs.

Phase 8: Implement loading, empty, error and permission states.

Phase 9: Test responsiveness and interactions.

Phase 10: Run production build and fix all errors.

## 16. Final Deliverables

Deliver a fully working Next.js frontend.

Requirements:

- Production-ready code.
- TypeScript strict mode.
- Reusable components.
- Centralized JSON color configuration.
- Responsive layouts.
- Real backend integration.
- Secure authentication flow.
- Permission-aware UI.
- Consistent rounded box-shaped design.
- Clean project structure.
- No unnecessary dependencies.
- No unfinished placeholder pages.
- No non-functional interactions.

Before finishing, run:

npm run lint
npm run typecheck
npm run build

Fix all errors.

## Final Design Objective

Create a premium, minimalistic, professional SaaS interface using a consistent rounded rectangular box design system.

The application should feel custom-designed, elegant, modern, structured and production-ready.

The most important visual characteristics are:

1. Rounded rectangular box-shaped components everywhere.
2. Consistent custom colors controlled through colors.json.
3. Minimal professional layouts.
4. Subtle borders and shadows.
5. Excellent typography and spacing.
6. Fully responsive design.
7. Real integration with the existing backend.

Do not compromise the design quality for implementation speed.