import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-xl border bg-card p-6">{children}</div>
      {footer && (
        <p className="text-center text-[13px] text-muted-foreground">
          {footer}
        </p>
      )}
    </div>
  );
}

export function FormAlert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "success";
  children: React.ReactNode;
}) {
  const Icon = tone === "danger" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
        tone === "danger"
          ? "border-danger/20 bg-danger/10 text-danger"
          : "border-success/20 bg-success/10 text-success",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
