/* eslint-disable @next/next/no-img-element -- static brand assets, no optimisation needed */
import { APP_NAME } from "@/config/navigation";
import { cn } from "@/lib/utils";

/** Square eye mark (collapsed sidebar, small placements). Black strokes swap to light in dark mode. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative block size-9 shrink-0", className)}>
      <img src="/logo-mark.png" alt={APP_NAME} className="size-full object-contain dark:hidden" />
      <img src="/logo-mark-dark.png" alt={APP_NAME} className="hidden size-full object-contain dark:block" />
    </span>
  );
}

/** Full Ragama Opticians logo. */
export function Brand({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  if (collapsed) return <BrandMark />;
  return (
    <span className={cn("block h-12 shrink-0", className)}>
      <img src="/logo.png" alt={APP_NAME} className="h-full w-auto object-contain dark:hidden" />
      <img src="/logo-dark.png" alt={APP_NAME} className="hidden h-full w-auto object-contain dark:block" />
    </span>
  );
}
