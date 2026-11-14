import {
  Award,
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarRange,
  Clock,
  Contact,
  FileSignature,
  FileText,
  GitBranch,
  Inbox,
  KeyRound,
  Laptop,
  Layers,
  LayoutGrid,
  ListChecks,
  LogOut,
  MapPin,
  Megaphone,
  Network,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Timer,
  UserCircle,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Permission required to see the item. */
  permission?: string;
  /** "tenant": needs an organization selected; "platform": only without one. */
  context?: "tenant" | "platform";
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Invoteam HRM";

export const navigation: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", href: "/", icon: LayoutGrid },
      { title: "My Workspace", href: "/me", icon: UserCircle, permission: "self:access", context: "tenant" },
      { title: "Approvals", href: "/approvals", icon: Inbox, context: "tenant" },
    ],
  },
  {
    title: "Organization",
    items: [
      { title: "Organization Chart", href: "/organization/chart", icon: Network, permission: "organization:read", context: "tenant" },
    ],
  },
  {
    title: "People",
    items: [
      { title: "Employees", href: "/employees", icon: Contact, permission: "employees:read", context: "tenant" },
      { title: "Employee Documents", href: "/documents", icon: FileText, permission: "documents:read", context: "tenant" },
      { title: "Employment Contracts", href: "/contracts", icon: FileSignature, permission: "contracts:read", context: "tenant" },
      { title: "Onboarding", href: "/onboarding", icon: ListChecks, permission: "employees:read", context: "tenant" },
      { title: "Exit Management", href: "/exit", icon: LogOut, permission: "exit:read", context: "tenant" },
    ],
  },
  {
    title: "Time & Attendance",
    items: [
      { title: "Attendance", href: "/attendance", icon: Clock, permission: "attendance:read", context: "tenant" },
    ],
  },
  {
    title: "Leave",
    items: [
      { title: "Leave Requests", href: "/leave", icon: CalendarDays, permission: "leave:read", context: "tenant" },
      { title: "Leave Calendar", href: "/leave/calendar", icon: CalendarRange, permission: "leave:read", context: "tenant" },
    ],
  },
  {
    title: "Payroll",
    items: [
      { title: "Salary Structures", href: "/payroll/salaries", icon: Wallet, permission: "payroll:read", context: "tenant" },
      { title: "Payroll Processing", href: "/payroll/runs", icon: BadgeDollarSign, permission: "payroll:read", context: "tenant" },
      { title: "Payslips", href: "/payroll/payslips", icon: Receipt, permission: "payroll:read", context: "tenant" },
      { title: "Payroll Reports", href: "/reports?type=payroll", icon: BarChart3, permission: "payroll:read", context: "tenant" },
    ],
  },
  {
    title: "Talent",
    items: [
      { title: "Recruitment", href: "/recruitment", icon: UserPlus, permission: "recruitment:read", context: "tenant" },
      { title: "Vacancies", href: "/recruitment/vacancies", icon: Briefcase, permission: "recruitment:read", context: "tenant" },
      { title: "Applicants", href: "/recruitment/applicants", icon: Users, permission: "recruitment:read", context: "tenant" },
      { title: "Performance", href: "/performance", icon: Award, permission: "performance:read", context: "tenant" },
      { title: "Training", href: "/training", icon: BookOpen, permission: "training:read", context: "tenant" },
    ],
  },
  {
    title: "Master Data",
    items: [
      { title: "Branches", href: "/organization/branches", icon: MapPin, permission: "organization:read", context: "tenant" },
      { title: "Departments", href: "/organization/departments", icon: Building2, permission: "organization:read", context: "tenant" },
      { title: "Designations", href: "/organization/designations", icon: Briefcase, permission: "organization:read", context: "tenant" },
      { title: "Organization Levels", href: "/organization/levels", icon: Layers, permission: "organization:read", context: "tenant" },
      { title: "Shifts", href: "/shifts", icon: Timer, permission: "shifts:manage", context: "tenant" },
      { title: "Work Schedules", href: "/schedules", icon: CalendarRange, permission: "shifts:manage", context: "tenant" },
      { title: "Holidays", href: "/holidays", icon: Sun, permission: "organization:read", context: "tenant" },
      { title: "Leave Types", href: "/leave/types", icon: SlidersHorizontal, permission: "leave:manage", context: "tenant" },
      { title: "Leave Policies", href: "/leave/policies", icon: ScrollText, permission: "leave:manage", context: "tenant" },
      { title: "Statutory Policies", href: "/payroll/policies", icon: ScrollText, permission: "payroll:read", context: "tenant" },
    ],
  },
  {
    title: "Administration",
    items: [
      { title: "Assets", href: "/assets", icon: Laptop, permission: "assets:read", context: "tenant" },
      { title: "Expenses", href: "/expenses", icon: Receipt, permission: "expenses:read", context: "tenant" },
      { title: "Workflows", href: "/workflows", icon: GitBranch, permission: "workflows:manage", context: "tenant" },
      { title: "Announcements", href: "/announcements", icon: Megaphone, permission: "announcements:manage", context: "tenant" },
      { title: "Reports", href: "/reports", icon: BarChart3, permission: "reports:read", context: "tenant" },
      { title: "HR Settings", href: "/hr-settings", icon: Settings, permission: "settings:manage", context: "tenant" },
      { title: "Users", href: "/users", icon: Users, permission: "users:read", context: "tenant" },
      { title: "Roles", href: "/roles", icon: ShieldCheck, permission: "roles:read", context: "tenant" },
      { title: "Permissions", href: "/permissions", icon: KeyRound, permission: "permissions:read", context: "tenant" },
    ],
  },
  {
    title: "Platform",
    items: [{ title: "Tenants", href: "/tenants", icon: Building2, permission: "tenants:read", context: "platform" }],
  },
  { title: "Account", items: [{ title: "Settings", href: "/settings", icon: Settings }] },
];

export function visibleNavigation(can: (p: string) => boolean, inTenant: boolean): NavGroup[] {
  return navigation
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!i.permission || can(i.permission)) &&
          (!i.context || (i.context === "tenant" ? inTenant : !inTenant)),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

export function findNavItem(pathname: string): NavItem | undefined {
  // Longest matching href wins, so /leave/calendar resolves to Leave Calendar, not Leave Requests.
  const items = navigation.flatMap((g) => g.items).filter((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href.split("?")[0]!)));
  const base = (h: string) => h.split("?")[0]!.length;
  return items.sort((a, b) => base(b.href) - base(a.href) || a.href.length - b.href.length)[0];
}
