"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none__";

/**
 * Form select over the shared Select primitive. `value` null means "nothing selected";
 * pass `noneLabel` to let the user clear it.
 */
export function SelectField({
  value,
  onChange,
  options,
  placeholder = "Select…",
  noneLabel,
  disabled,
  ...aria
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  noneLabel?: string;
  disabled?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const items = noneLabel ? [{ value: NONE, label: noneLabel }, ...options] : options;
  return (
    <Select
      items={items}
      value={value ?? (noneLabel ? NONE : null)}
      onValueChange={(v) => onChange(v === NONE || v === null ? null : String(v))}
      disabled={disabled}
    >
      <SelectTrigger {...aria} className="w-full min-w-0">
        <SelectValue placeholder={placeholder} className="truncate" />
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-xl p-1">
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value} className="rounded-lg px-2 py-1.5">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
