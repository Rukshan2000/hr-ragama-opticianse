import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-xl border bg-subtle text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-xl border border-danger/20 bg-danger/10 text-danger">
        <AlertTriangle className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">Couldn&apos;t load this</p>
        <p className="max-w-sm text-[13px] text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingState({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}
