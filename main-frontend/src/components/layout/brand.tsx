import { cn } from "@/lib/utils";

/** Square mark (collapsed sidebar, small placements). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-lg font-bold text-white", className)}>
      I
    </span>
  );
}

/** Invoteam wordmark. */
export function Brand({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  if (collapsed) return <BrandMark />;
  return (
    <span className={cn("flex h-12 shrink-0 items-center gap-2", className)}>
      <BrandMark />
      <span className="text-xl font-bold tracking-tight">
        Invo<span className="text-brand">team</span>
      </span>
    </span>
  );
}
