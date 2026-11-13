import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-7xl space-y-6", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ContentCard({
  title,
  description,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="space-y-0.5">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className="grid size-8 place-items-center rounded-lg bg-subtle text-brand-accent">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {loading ? <span className="block h-8 w-16 animate-pulse rounded-lg bg-subtle" /> : value}
      </div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}
