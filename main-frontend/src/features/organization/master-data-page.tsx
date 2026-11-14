"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  type LucideIcon,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { ActiveBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DataTable,
  FilterDropdown,
  Pagination,
  SearchInput,
  type Column,
} from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ListParams, Paginated } from "@/lib/api/types";

export interface MasterField {
  name: string;
  label: string;
  type?: "text" | "code" | "email" | "number" | "textarea" | "timezone";
  required?: boolean;
  hint?: string;
  wide?: boolean;
  /** Blank on create → server generates it. Required again when editing. */
  autoGenerate?: boolean;
}

type Row = { id: string; isActive?: boolean } & Record<string, unknown>;

export interface MasterConfig<T extends Row> {
  queryKey: string;
  title: string;
  singular: string;
  description: string;
  icon: LucideIcon;
  api: {
    list: (
      p: ListParams & Record<string, string | number | boolean | undefined>,
    ) => Promise<Paginated<T>>;
    create: (b: object) => Promise<unknown>;
    update: (id: string, b: object) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    /** Suggests the next code; shows a generate button on autoGenerate fields. */
    nextCode?: () => Promise<{ code: string }>;
  };
  fields: MasterField[];
  columns: Column<T>[];
  /** Entities with an is_active flag get a status column, filter and toggle. */
  hasActive: boolean;
  defaultSort: { sort: string; order: "asc" | "desc" };
  /** Shown in the delete confirmation. */
  deleteHint: string;
}

const TIMEZONES = Intl.supportedValuesOf("timeZone").map((tz) => ({
  value: tz,
  label: tz.replaceAll("_", " "),
}));

function fieldSchema(f: MasterField, editing: boolean) {
  if (f.autoGenerate && !editing) f = { ...f, required: false };
  if (f.type === "number")
    return z.coerce
      .number({ error: "Enter a number" })
      .int("Whole numbers only")
      .min(1, "Must be 1 or more");
  let s = z
    .string()
    .trim()
    .max(f.type === "textarea" ? 500 : 150);
  if (f.type === "code")
    s = s.regex(
      /^[A-Za-z0-9._-]*$/,
      "Letters, numbers, dot, dash or underscore",
    );
  if (f.type === "email")
    return f.required
      ? z.email("Enter a valid email")
      : z.union([z.literal(""), z.email("Enter a valid email")]);
  return f.required ? s.min(1, `Enter ${f.label.toLowerCase()}`) : s;
}

function MasterDialog<T extends Row>({
  config,
  editing,
  open,
  onOpenChange,
}: {
  config: MasterConfig<T>;
  editing: T | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const generate = async (name: string) => {
    setGenerating(true);
    try {
      const { code } = await config.api.nextCode!();
      form.setValue(name, code, { shouldValidate: true, shouldDirty: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGenerating(false);
    }
  };
  const schema = useMemo(
    () =>
      z.object(
        Object.fromEntries(
          config.fields.map((f) => [f.name, fieldSchema(f, Boolean(editing))]),
        ) as Record<string, z.ZodType>,
      ),
    [config.fields, editing],
  );
  const defaults = (row: T | null) =>
    Object.fromEntries(
      config.fields.map((f) => [
        f.name,
        row?.[f.name] ??
          (f.type === "timezone"
            ? "Asia/Colombo"
            : f.type === "number"
              ? ""
              : ""),
      ]),
    );
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    values: defaults(editing),
  });
  const { errors, isSubmitting } = form.formState;
  // `values` only resyncs when the defaults change, so "new" after "new" kept the old input.
  useEffect(() => {
    if (open) form.reset(defaults(editing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const close = (o: boolean) => {
    if (!o) setError(null);
    onOpenChange(o);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    // Optional empty strings become null so the backend clears them.
    const body = Object.fromEntries(
      Object.entries(values)
        .filter(
          ([k, v]) =>
            !(
              v === "" &&
              !editing &&
              config.fields.find((f) => f.name === k)?.autoGenerate
            ),
        )
        .map(([k, v]) => [k, v === "" ? null : v]),
    );
    try {
      if (editing) await config.api.update(editing.id, body);
      else await config.api.create(body);
      toast.success(`${config.singular} ${editing ? "updated" : "created"}`);
      qc.invalidateQueries({ queryKey: [config.queryKey] });
      close(false);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <config.icon className="size-5" />
          </span>
          <div className="grid gap-1">
            <DialogTitle>
              {editing
                ? `Edit ${config.singular.toLowerCase()}`
                : `New ${config.singular.toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>{config.description}</DialogDescription>
          </div>
        </DialogHeader>
        <form
          id="master-form"
          onSubmit={onSubmit}
          className="grid gap-4 sm:grid-cols-2"
          noValidate
        >
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          {config.fields.map((f) => (
            <FormField
              key={f.name}
              label={
                f.required && !(f.autoGenerate && !editing)
                  ? f.label
                  : `${f.label} (${f.autoGenerate && !editing ? "auto" : "optional"})`
              }
              hint={
                f.autoGenerate && !editing
                  ? "Leave blank to auto-generate"
                  : f.hint
              }
              error={errors[f.name]?.message as string | undefined}
              className={
                f.wide || f.type === "textarea" || f.type === "timezone"
                  ? "sm:col-span-2"
                  : undefined
              }
            >
              {(p) =>
                f.type === "textarea" ? (
                  <Textarea {...p} rows={3} {...form.register(f.name)} />
                ) : f.type === "timezone" ? (
                  <Controller
                    control={form.control}
                    name={f.name}
                    render={({ field }) => (
                      <SelectField
                        {...p}
                        value={field.value as string}
                        onChange={(v) => field.onChange(v ?? "Asia/Colombo")}
                        options={TIMEZONES}
                      />
                    )}
                  />
                ) : (
                  <div className="relative">
                    <Input
                      {...p}
                      type={
                        f.type === "number"
                          ? "number"
                          : f.type === "email"
                            ? "email"
                            : "text"
                      }
                      className={cn(
                        f.type === "code" && "font-mono uppercase",
                        f.autoGenerate && config.api.nextCode && "pr-11",
                      )}
                      placeholder={
                        f.autoGenerate && !editing ? "Auto" : undefined
                      }
                      {...form.register(f.name)}
                    />
                    {f.autoGenerate && config.api.nextCode && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title="Generate code"
                        aria-label="Generate code"
                        disabled={generating}
                        onClick={() => generate(f.name)}
                        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-primary hover:bg-primary/10"
                      >
                        {generating ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Sparkles />
                        )}
                      </Button>
                    )}
                  </div>
                )
              }
            </FormField>
          ))}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form="master-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {editing
              ? "Save changes"
              : `Create ${config.singular.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ActiveFilter = "all" | "active" | "inactive";

export function MasterDataPage<T extends Row>({
  config,
}: {
  config: MasterConfig<T>;
}) {
  const { can } = useSession();
  const canManage = can("organization:manage");
  const qc = useQueryClient();
  const list = useListState(config.defaultSort);
  const [active, setActive] = useState<ActiveFilter>("all");
  const [dialog, setDialog] = useState<{ open: boolean; row: T | null }>({
    open: false,
    row: null,
  });
  const [removing, setRemoving] = useState<T | null>(null);

  const params = {
    ...list.params,
    isActive: active === "all" ? undefined : active === "active",
  };
  const query = useQuery({
    queryKey: [config.queryKey, "list", params],
    queryFn: () => config.api.list(params),
    placeholderData: (p) => p,
  });

  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: [config.queryKey] });
  };
  const toggle = useMutation({
    mutationFn: (r: T) => config.api.update(r.id, { isActive: !r.isActive }),
    onSuccess: (_, r) =>
      done(`${config.singular} ${r.isActive ? "deactivated" : "activated"}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (r: T) => config.api.remove(r.id),
    onSuccess: () => {
      done(`${config.singular} deleted`);
      setRemoving(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<T>[] = [
    ...config.columns,
    ...(config.hasActive
      ? [
          {
            key: "status",
            header: "Status",
            cell: (r: T) => <ActiveBadge active={Boolean(r.isActive)} />,
          },
        ]
      : []),
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r: T) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ActionDropdown
            items={[
              {
                label: "Edit",
                icon: Pencil,
                hidden: !canManage,
                onSelect: () => setDialog({ open: true, row: r }),
              },
              {
                label: r.isActive ? "Deactivate" : "Activate",
                icon: Power,
                hidden: !canManage || !config.hasActive,
                onSelect: () => toggle.mutate(r),
              },
              {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                hidden: !canManage,
                onSelect: () => setRemoving(r),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const filtered = Boolean(list.params.search) || active !== "all";

  return (
    <PageContainer>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          canManage && (
            <Button onClick={() => setDialog({ open: true, row: null })}>
              <Plus /> New {config.singular.toLowerCase()}
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.error?.message}
        onRetry={() => query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={
          canManage ? (r) => setDialog({ open: true, row: r }) : undefined
        }
        toolbar={
          <>
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              placeholder={`Search ${config.title.toLowerCase()}`}
            />
            {config.hasActive && (
              <FilterDropdown<ActiveFilter>
                label="Status"
                value={active}
                onChange={(v) => {
                  setActive(v);
                  list.setPage(1);
                }}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
              />
            )}
          </>
        }
        empty={
          <EmptyState
            icon={config.icon}
            title={
              filtered
                ? `No ${config.title.toLowerCase()} match your filters`
                : `No ${config.title.toLowerCase()} yet`
            }
            description={
              filtered
                ? "Try a different search or status."
                : canManage
                  ? `Create your first ${config.singular.toLowerCase()}.`
                  : undefined
            }
          />
        }
        footer={
          <Pagination meta={query.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />
        }
      />
      <MasterDialog
        config={config}
        open={dialog.open}
        editing={dialog.row}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${config.singular.toLowerCase()}?`}
        description={config.deleteHint}
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </PageContainer>
  );
}
