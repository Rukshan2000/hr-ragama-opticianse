"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + control + error/hint. The child control gets id/aria wiring via render prop. */
export function FormField({
  label,
  error,
  hint,
  action,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  action?: React.ReactNode;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-[13px]">
          {label}
        </Label>
        {action}
      </div>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": descId })}
      {(error || hint) && (
        <p id={descId} className={cn("text-xs", error ? "text-danger" : "text-text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function PasswordInput(props: React.ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", props.className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
