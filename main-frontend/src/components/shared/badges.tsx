import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONES = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-info/10 text-info border-info/20",
  neutral: "bg-subtle text-muted-foreground border-border",
} as const;

export function StatusBadge({
  tone = "neutral",
  dot = true,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <StatusBadge tone={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</StatusBadge>;
}

export function UserAvatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: "size-7 text-[11px] rounded-lg", md: "size-9 text-xs rounded-[10px]", lg: "size-12 text-sm rounded-xl" }[size];
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center bg-brand font-semibold text-primary-foreground", s, className)}
    >
      {initials(name) || "?"}
    </span>
  );
}
